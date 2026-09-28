import { NextResponse } from "next/server";
import { requireUser, requireWorkspaceRole, route, workspaceOfWidget } from "@/lib/authz";
import { computeSeries, computeStackedSeries, computeScatterPoints, computeKpi, type CrossFilter } from "@/lib/dashboard-engine";
import { applyFilters, applySorts, getCellValue } from "@/lib/query-engine";
import { formatDisplayValue } from "@/lib/format";
import { loadBlockData } from "@/lib/dashboard-data";
import type { FieldRow } from "@/types";

type P = { blockId: string };

// Computes a widget's data fresh from the project's live tasks on every call -
// dashboards persist only widget configuration, never a snapshot of data.
export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { blockId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfWidget(blockId), "viewer");
  const userId = user.id;
  const body = (await req.json().catch(() => ({}))) as { slicers?: CrossFilter[]; crossFilter?: CrossFilter };

  const data = await loadBlockData(user, ctx.workspaceId, blockId, body);
  if ("error" in data) return NextResponse.json({ error: data.error, series: [], rows: [], fields: [] });
  const { type, config, fields, records, members: memberList } = data;

  if (type === "kpi") {
    return NextResponse.json({ kpi: computeKpi(records, fields, config, userId) });
  }

  if (type === "table") {
    const filtered = applyFilters(records, fields, config.filters, userId);
    const sorted = applySorts(filtered, fields, undefined);
    const tableFieldIds = config.tableFieldIds?.length ? config.tableFieldIds : fields.map((f) => f.id);
    const byId = new Map(fields.map((f: FieldRow) => [f.id, f]));
    const rows = sorted
      .slice(0, 200)
      .map((r) => tableFieldIds.map((fid) => (byId.get(fid) ? formatDisplayValue(byId.get(fid)!, getCellValue(r, byId.get(fid)!, fields), memberList) : "")));
    return NextResponse.json({
      rows,
      columns: tableFieldIds.map((fid) => byId.get(fid)?.name ?? fid),
      fields: tableFieldIds.map((fid) => byId.get(fid)).filter(Boolean),
    });
  }

  if (type === "stacked_column" || type === "stacked_bar") {
    return NextResponse.json(computeStackedSeries(records, fields, config, memberList, userId));
  }

  if (type === "scatter") {
    return NextResponse.json({ points: computeScatterPoints(records, fields, config, userId) });
  }

  return NextResponse.json({ series: computeSeries(records, fields, config, memberList, userId) });
});

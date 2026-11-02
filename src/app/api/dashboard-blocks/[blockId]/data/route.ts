import { NextResponse } from "next/server";
import { requireUser, requireWorkspaceRole, route, workspaceOfWidget } from "@/lib/authz";
import { computePivot, computeSeries, computeStackedSeries, computeScatterPoints, computeKpi, computeKpiTrend, type CrossFilter } from "@/lib/dashboard-engine";
import { applyFilters, applySorts, getCellValue } from "@/lib/query-engine";
import { formatDisplayValue } from "@/lib/format";
import { loadBlockData } from "@/lib/dashboard-data";
import { computeMatrix } from "@/lib/pivot-matrix";
import type { FieldRow } from "@/types";

type P = { blockId: string };

// Computes a widget's data fresh from the project's live tasks on every call -
// dashboards persist only widget configuration, never a snapshot of data.
export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { blockId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfWidget(blockId), "viewer");
  const userId = user.id;
  const body = (await req.json().catch(() => ({}))) as { slicers?: unknown[]; crossFilter?: CrossFilter; pivotLevels?: { rows?: unknown; cols?: unknown } };

  const data = await loadBlockData(user, ctx.workspaceId, blockId, body);
  if ("error" in data) return NextResponse.json({ error: data.error, series: [], rows: [], fields: [] });
  const { type, config, fields, records, members: memberList } = data;
  // Tells the viewer some sources are left out (hidden from them), so a smaller total is not taken for the whole.
  // "No data" for the current filters (slicers, click, widget / view filters), so the card says so.
  const empty = applyFilters(records, fields, config.filters, userId).length === 0;
  const extra = { ...(data.hiddenSources ? { hiddenSources: data.hiddenSources } : {}), ...(empty ? { empty: true } : {}) };

  if (type === "kpi") {
    const trend = computeKpiTrend(records, fields, config, userId);
    const value = trend?.current ?? computeKpi(records, fields, config, userId);
    return NextResponse.json({ ...extra, kpi: value, kpiTrend: trend });
  }

  if (type === "table") {
    const filtered = applyFilters(records, fields, config.filters, userId);
    const sorted = applySorts(filtered, fields, undefined);
    const tableFieldIds = config.tableFieldIds?.length ? config.tableFieldIds : fields.map((f) => f.id);
    const byId = new Map(fields.map((f: FieldRow) => [f.id, f]));
    const rows = sorted
      .slice(0, 200)
      .map((r) => tableFieldIds.map((fid) => (byId.get(fid) ? formatDisplayValue(byId.get(fid)!, getCellValue(r, byId.get(fid)!, fields), memberList) : "")));
    return NextResponse.json({ ...extra,
      rows,
      columns: tableFieldIds.map((fid) => byId.get(fid)?.name ?? fid),
      fields: tableFieldIds.map((fid) => byId.get(fid)).filter(Boolean),
    });
  }

  if (type === "pivot") {
    // D4: the matrix (several row / column levels, subtotals); the viewer may hide levels.
    const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 8) : undefined);
    const levels = body.pivotLevels ? { rows: ids(body.pivotLevels.rows), cols: ids(body.pivotLevels.cols) } : undefined;
    return NextResponse.json({ ...extra, pivot: computePivot(records, fields, config, memberList, userId), matrix: computeMatrix(records, fields, config, memberList, userId, levels) });
  }

  if (type === "stacked_column" || type === "stacked_bar") {
    return NextResponse.json({ ...extra, ...computeStackedSeries(records, fields, config, memberList, userId) });
  }

  if (type === "scatter") {
    return NextResponse.json({ ...extra, points: computeScatterPoints(records, fields, config, userId) });
  }

  return NextResponse.json({ ...extra, series: computeSeries(records, fields, config, memberList, userId) });
});

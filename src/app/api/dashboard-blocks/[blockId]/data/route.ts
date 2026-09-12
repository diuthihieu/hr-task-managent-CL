import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership, getWorkspaceIdForDashboardBlock } from "@/lib/permissions";
import { computeSeries, computeStackedSeries, computeScatterPoints, computeKpi, mergeFilters, parseBlockConfig, resolveCrossFilterConditions, type CrossFilter } from "@/lib/dashboard-engine";
import { applyFilters, applySorts, getCellValue } from "@/lib/query-engine";
import { formatDisplayValue } from "@/lib/format";
import type { FieldRow, RecordRow } from "@/types";

// Computes a single widget's data fresh from the Base's live records every
// call - dashboards never persist a snapshot of chart data, only the widget
// *configuration* (data source + dimension/measure/filters), so editing a
// Grid row is reflected the next time this endpoint is polled.
export async function POST(req: Request, { params }: { params: Promise<{ blockId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { blockId } = await params;
  const workspaceId = await getWorkspaceIdForDashboardBlock(blockId);
  if (!workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = (session.user as { id: string }).id;

  const block = await prisma.dashboardBlock.findUnique({ where: { id: blockId } });
  if (!block) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const config = parseBlockConfig(block.config);
  const tableId = config.dataSource?.tableId;
  if (!tableId) return NextResponse.json({ error: "No data source configured", series: [], rows: [], fields: [] });

  const body = await req.json().catch(() => ({}));
  const { slicers, crossFilter } = body as { slicers?: CrossFilter[]; crossFilter?: CrossFilter };

  const [fields, recordRows, view, members] = await Promise.all([
    prisma.field.findMany({ where: { tableId }, orderBy: { order: "asc" } }),
    prisma.record.findMany({ where: { tableId } }),
    config.dataSource?.viewId ? prisma.view.findUnique({ where: { id: config.dataSource.viewId } }) : Promise.resolve(null),
    prisma.workspaceMember.findMany({ where: { workspaceId }, include: { user: { select: { id: true, name: true, avatarColor: true } } } }),
  ]);

  const records: RecordRow[] = recordRows.map((r) => ({
    ...r,
    data: JSON.parse(r.data || "{}"),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
  const memberList = members.map((m) => m.user);

  const viewConfig = view ? (JSON.parse(view.config || "{}") as { filters?: typeof config.filters }) : null;
  const slicerConditions = resolveCrossFilterConditions(fields, memberList, slicers);
  const clickConditions = resolveCrossFilterConditions(fields, memberList, crossFilter ? [crossFilter] : undefined);
  const namedGroup = { conjunction: "AND" as const, conditions: [...slicerConditions, ...clickConditions] };
  const effectiveFilters = mergeFilters(viewConfig?.filters, config.filters, namedGroup);
  const configWithMergedFilters = { ...config, filters: effectiveFilters };

  if (block.type === "kpi") {
    const value = computeKpi(records, fields, configWithMergedFilters, userId);
    return NextResponse.json({ kpi: value });
  }

  if (block.type === "table") {
    const filtered = applyFilters(records, fields, effectiveFilters, userId);
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

  if (block.type === "stacked_column" || block.type === "stacked_bar") {
    const stacked = computeStackedSeries(records, fields, configWithMergedFilters, memberList, userId);
    return NextResponse.json(stacked);
  }

  if (block.type === "scatter") {
    const points = computeScatterPoints(records, fields, configWithMergedFilters, userId);
    return NextResponse.json({ points });
  }

  const series = computeSeries(records, fields, configWithMergedFilters, memberList, userId);
  return NextResponse.json({ series });
}

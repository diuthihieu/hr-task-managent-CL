import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, workspaceOfWidget } from "@/lib/authz";
import { computeSeries, computeStackedSeries, computeScatterPoints, computeKpi, mergeFilters, parseBlockConfig, resolveCrossFilterConditions, type CrossFilter } from "@/lib/dashboard-engine";
import { applyFilters, applySorts, getCellValue } from "@/lib/query-engine";
import { formatDisplayValue } from "@/lib/format";
import { loadProjectGrid } from "@/lib/task-grid";
import type { FieldRow } from "@/types";

type P = { blockId: string };

// Computes a widget's data fresh from the project's live tasks on every call -
// dashboards persist only widget configuration, never a snapshot of data.
export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { blockId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfWidget(blockId), "viewer");
  const userId = user.id;

  const block = await prisma.dashboardWidget.findUniqueOrThrow({ where: { id: blockId } });
  const config = parseBlockConfig(JSON.stringify(block.config ?? {}));
  const projectId = config.dataSource?.projectId;
  if (!projectId) return NextResponse.json({ error: "No data source configured", series: [], rows: [], fields: [] });

  const body = await req.json().catch(() => ({}));
  const { slicers, crossFilter } = body as { slicers?: CrossFilter[]; crossFilter?: CrossFilter };

  // The data source must be a project in this dashboard's own workspace.
  const project = await prisma.project.findFirst({ where: { id: projectId, workspaceId: ctx.workspaceId, deletedAt: null }, select: { id: true } });
  if (!project) return NextResponse.json({ error: "Data source no longer exists", series: [], rows: [], fields: [] });

  const [grid, view, members] = await Promise.all([
    loadProjectGrid(projectId),
    config.dataSource?.viewId ? prisma.view.findFirst({ where: { id: config.dataSource.viewId, projectId } }) : Promise.resolve(null),
    prisma.workspaceMember.findMany({ where: { workspaceId: ctx.workspaceId }, include: { user: { select: { id: true, name: true, avatarColor: true } } } }),
  ]);
  const fields = grid!.fields;
  const records = grid!.records;
  const memberList = members.map((m) => m.user);

  const viewConfig = view ? (view.config as { filters?: typeof config.filters }) : null;
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
});

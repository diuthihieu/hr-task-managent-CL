import { prisma } from "@/lib/prisma";
import { hiddenProjectIds, type SessionUser } from "@/lib/authz";
import { mergeFilters, parseBlockConfig, resolveCrossFilterConditions, type CrossFilter, type DashboardBlockConfig } from "@/lib/dashboard-engine";
import { loadProjectGrid } from "@/lib/task-grid";
import type { FieldRow, RecordRow } from "@/types";

export interface BlockData {
  type: string;
  /** Widget config with view, widget, slicer and click filters merged into `filters`. */
  config: DashboardBlockConfig;
  fields: FieldRow[];
  records: RecordRow[];
  members: { id: string; name: string; avatarColor: string }[];
}

/**
 * Live inputs for one dashboard widget: its project's current tasks plus every
 * filter that applies. Returns an error string when the data source is gone
 * (or hidden from this user). Dashboards store configuration only, never data.
 */
export async function loadBlockData(
  user: SessionUser,
  workspaceId: string,
  blockId: string,
  body: { slicers?: CrossFilter[]; crossFilter?: CrossFilter | null }
): Promise<BlockData | { error: string }> {
  const block = await prisma.dashboardWidget.findUniqueOrThrow({ where: { id: blockId } });
  const config = parseBlockConfig(JSON.stringify(block.config ?? {}));
  const projectId = config.dataSource?.projectId;
  if (!projectId) return { error: "No data source configured" };

  // The data source must be a project in this dashboard's own workspace that the caller may see.
  const project = await prisma.project.findFirst({ where: { id: projectId, workspaceId, deletedAt: null }, select: { id: true } });
  if (!project || (await hiddenProjectIds(user)).has(projectId)) return { error: "Data source no longer exists" };

  const [grid, view, members] = await Promise.all([
    loadProjectGrid(projectId),
    config.dataSource?.viewId ? prisma.view.findFirst({ where: { id: config.dataSource.viewId, projectId } }) : Promise.resolve(null),
    prisma.workspaceMember.findMany({ where: { workspaceId }, include: { user: { select: { id: true, name: true, avatarColor: true } } } }),
  ]);
  const fields = grid!.fields;
  const memberList = members.map((m) => m.user);
  const viewConfig = view ? (view.config as { filters?: typeof config.filters }) : null;
  const slicerConditions = resolveCrossFilterConditions(fields, memberList, body.slicers);
  const clickConditions = resolveCrossFilterConditions(fields, memberList, body.crossFilter ? [body.crossFilter] : undefined);
  const named = { conjunction: "AND" as const, conditions: [...slicerConditions, ...clickConditions] };
  return {
    type: block.type,
    config: { ...config, filters: mergeFilters(viewConfig?.filters, config.filters, named) },
    fields,
    records: grid!.records,
    members: memberList,
  };
}

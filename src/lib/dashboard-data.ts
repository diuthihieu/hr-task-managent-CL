import { prisma } from "@/lib/prisma";
import { HttpError, hiddenProjectIds, type SessionUser } from "@/lib/authz";
import { appendSources, mergeSource, type Source } from "@/lib/data-combine";
import { mergeFilters, widgetConfigProblem, parseBlockConfig, resolveCrossFilterConditions, type CrossFilter, type DashboardBlockConfig } from "@/lib/dashboard-engine";
import { loadProjectGrid } from "@/lib/task-grid";
import type { FieldRow, RecordRow } from "@/types";

export interface BlockData {
  type: string;
  /** Widget config with view, widget, slicer and click filters merged into `filters`. */
  config: DashboardBlockConfig;
  fields: FieldRow[];
  records: RecordRow[];
  members: { id: string; name: string; avatarColor: string }[];
  /** Appended / merged projects left out because they are hidden from this viewer. */
  hiddenSources: number;
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

  const [{ grid, hiddenSources }, view, members] = await Promise.all([
    loadCombinedGrid(user, workspaceId, projectId, config.dataSource ?? {}),
    config.dataSource?.viewId ? prisma.view.findFirst({ where: { id: config.dataSource.viewId, projectId } }) : Promise.resolve(null),
    prisma.workspaceMember.findMany({ where: { workspaceId }, include: { user: { select: { id: true, name: true, avatarColor: true } } } }),
  ]);
  const fields = grid!.fields;
  const problem = widgetConfigProblem(block.type, config, fields);
  if (problem) return { error: problem };
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
    hiddenSources,
  };
}

/** Projects a widget reads from may at most be this many (main + appended + merged). */
const MAX_SOURCES = 10;

/**
 * The main project's grid, with appended projects stacked under it and a merged one joined in (U8b).
 * Sources hidden from the viewer are left out (counted in `hiddenSources`), but the widget keeps its
 * shape: the Project column stays, and merged columns stay with no values.
 */
async function loadCombinedGrid(user: SessionUser, workspaceId: string, projectId: string, ds: NonNullable<DashboardBlockConfig["dataSource"]>) {
  const grid = await loadProjectGrid(projectId);
  const extra = [...(ds.appendProjectIds ?? []), ...(ds.merge ? [ds.merge.projectId] : [])];
  if (!grid || !extra.length) return { grid, hiddenSources: 0 };
  const hidden = await hiddenProjectIds(user);
  const projects = await prisma.project.findMany({ where: { id: { in: [projectId, ...extra].slice(0, MAX_SOURCES) }, workspaceId, deletedAt: null }, select: { id: true, name: true } });
  const nameOf = new Map(projects.filter((p) => !hidden.has(p.id)).map((p) => [p.id, p.name]));
  const hiddenSources = new Set(extra.filter((id) => id !== projectId && hidden.has(id))).size;
  const source = async (id: string): Promise<Source | null> => {
    if (!nameOf.has(id)) return null;
    const g = await loadProjectGrid(id);
    return g ? { name: nameOf.get(id)!, fields: g.fields, records: g.records } : null;
  };
  let combined: Source = { name: nameOf.get(projectId) ?? "", fields: grid.fields, records: grid.records };
  if (ds.appendProjectIds?.length) {
    const appended = (await Promise.all(ds.appendProjectIds.filter((id) => id !== projectId).map(source))).filter((x): x is Source => !!x);
    combined = appendSources(combined, appended);
  }
  if (ds.merge) {
    const right = await source(ds.merge.projectId);
    if (right) combined = mergeSource(combined, right, ds.merge);
    else if (hidden.has(ds.merge.projectId)) {
      // Only the column definitions (named without the project): no row of the hidden project is used.
      const g = await loadProjectGrid(ds.merge.projectId);
      if (g) combined = mergeSource(combined, { name: "", fields: g.fields, records: [] }, ds.merge);
    }
  }
  return { grid: { ...grid, fields: combined.fields, records: combined.records }, hiddenSources };
}

/** A widget may only point at projects of its own workspace that the author can see. */
export async function assertWidgetSource(user: SessionUser, workspaceId: string, config: unknown) {
  const ds = (config as { dataSource?: { projectId?: unknown; viewId?: unknown; appendProjectIds?: unknown; merge?: { projectId?: unknown } } } | undefined)?.dataSource;
  const projectId = typeof ds?.projectId === "string" ? ds.projectId : null;
  if (!projectId) return;
  const ids = [projectId, ...(Array.isArray(ds?.appendProjectIds) ? ds.appendProjectIds : []), ...(ds?.merge ? [ds.merge.projectId] : [])];
  if (ids.length > MAX_SOURCES || ids.some((id) => typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))) throw new HttpError(400, "Unknown data source project");
  const found = await prisma.project.count({ where: { id: { in: ids as string[] }, workspaceId, deletedAt: null } });
  const hidden = await hiddenProjectIds(user);
  if (found !== new Set(ids).size || ids.some((id) => hidden.has(id as string))) throw new HttpError(400, "Unknown data source project");
  if (typeof ds?.viewId === "string" && !(await prisma.view.findFirst({ where: { id: ds.viewId, projectId }, select: { id: true } }))) throw new HttpError(400, "Unknown data source view");
}

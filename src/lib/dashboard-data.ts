import { prisma } from "@/lib/prisma";
import { HttpError, hiddenProjectIds, visibleProjectWhere, type SessionUser } from "@/lib/authz";
import { appendSources, mergeSource, type Source } from "@/lib/data-combine";
import { mergeFilters, widgetConfigProblem, parseBlockConfig, resolveCrossFilterConditions, type CrossFilter, type DashboardBlockConfig } from "@/lib/dashboard-engine";
import { mergeSlicerOptions, normalizeSlicer, slicerConditions, slicerOptions, type SlicerOptions, type SlicerSelection } from "@/lib/dashboard-slicers";
import { applyFilters } from "@/lib/query-engine";
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
  body: { slicers?: unknown[]; crossFilter?: CrossFilter | null }
): Promise<BlockData | { error: string }> {
  const block = await prisma.dashboardWidget.findUniqueOrThrow({ where: { id: blockId } });
  const config = parseBlockConfig(JSON.stringify(block.config ?? {}));
  const projectId = config.dataSource?.projectId;
  if (!projectId) return { error: "No data source configured" };

  // The data source must be a project in this dashboard's own workspace that the caller may see.
  const project = await prisma.project.findFirst({ where: { id: projectId, workspaceId, deletedAt: null }, select: { id: true } });
  if (!project) return { error: "Data source no longer exists" };
  // Main project hidden from this viewer: the widget still shows the appended projects they may see.
  const mainHidden = (await hiddenProjectIds(user)).has(projectId);
  if (mainHidden && !(await visibleAppended(user, workspaceId, config.dataSource ?? {})).length) return { error: "The data source project of this widget is hidden from you" };

  const [{ grid, hiddenSources }, view, members] = await Promise.all([
    loadCombinedGrid(user, workspaceId, projectId, config.dataSource ?? {}, mainHidden ? config : null),
    // A hidden main project's view isn't read (its filters stay unknown to the viewer).
    config.dataSource?.viewId && !mainHidden ? prisma.view.findFirst({ where: { id: config.dataSource.viewId, projectId } }) : Promise.resolve(null),
    prisma.workspaceMember.findMany({ where: { workspaceId }, include: { user: { select: { id: true, name: true, avatarColor: true } } } }),
  ]);
  const fields = grid!.fields;
  const problem = widgetConfigProblem(block.type, config, fields);
  if (problem) return { error: problem };
  const memberList = members.map((m) => m.user);
  const viewConfig = view ? (view.config as { filters?: typeof config.filters }) : null;
  const slicers = parseSlicers(body.slicers);
  const clickConditions = resolveCrossFilterConditions(fields, memberList, body.crossFilter ? [body.crossFilter] : undefined);
  const named = { conjunction: "AND" as const, conditions: [...slicerConditions(grid!.records, fields, memberList, slicers), ...clickConditions] };
  return {
    type: block.type,
    config: { ...config, filters: mergeFilters(viewConfig?.filters, config.filters, named) },
    fields,
    records: grid!.records,
    members: memberList,
    hiddenSources,
  };
}

/** Slicers of a request (current or old shape), at most 20. */
export function parseSlicers(raw: unknown[] | undefined): SlicerSelection[] {
  return (Array.isArray(raw) ? raw : []).slice(0, 20).map(normalizeSlicer).filter((x): x is SlicerSelection => !!x);
}

/**
 * Options of one dashboard slicer: its values (with counts) over every data source of the dashboard's
 * widgets that the viewer may see, after the other slicers and a chart click - like Power BI's linked
 * slicers. Hidden projects are left out, as everywhere.
 */
export async function dashboardSlicerOptions(user: SessionUser, workspaceId: string, dashboardId: string, fieldName: string, slicers: SlicerSelection[], crossFilter: CrossFilter | null): Promise<SlicerOptions> {
  const { grids, members } = await dashboardGrids(user, workspaceId, dashboardId);
  const parts: SlicerOptions[] = [];
  for (const grid of grids) {
    const click = resolveCrossFilterConditions(grid.fields, members, crossFilter ? [crossFilter] : undefined);
    const records = click.length ? applyFilters(grid.records, grid.fields, { conjunction: "AND", conditions: click }) : grid.records;
    parts.push(slicerOptions(records, grid.fields, members, { fieldName }, slicers));
  }
  const merged = mergeSlicerOptions(parts);
  delete merged.tasks; // ids behind the counts stay on the server
  return merged;
}

/**
 * Every data source of a dashboard's widgets as the viewer may see it: one grid per distinct source
 * (main + appended + merged), or, when the main project is hidden from the viewer, one grid per visible
 * appended project (slicers and report scopes match fields by name).
 */
async function dashboardGrids(user: SessionUser, workspaceId: string, dashboardId: string) {
  const widgets = await prisma.dashboardWidget.findMany({ where: { dashboardId }, select: { config: true }, take: 100 });
  const sources = new Map<string, NonNullable<DashboardBlockConfig["dataSource"]>>();
  for (const w of widgets) {
    const ds = parseBlockConfig(JSON.stringify(w.config ?? {})).dataSource;
    if (ds?.projectId) sources.set(JSON.stringify({ p: ds.projectId, a: ds.appendProjectIds ?? [], m: ds.merge ?? null }), ds);
  }
  const hidden = await hiddenProjectIds(user);
  const members = (await prisma.workspaceMember.findMany({ where: { workspaceId }, include: { user: { select: { id: true, name: true, avatarColor: true } } } })).map((m) => m.user);
  const grids: NonNullable<Awaited<ReturnType<typeof loadProjectGrid>>>[] = [];
  for (const ds of sources.values()) {
    const live = await prisma.project.findFirst({ where: { id: ds.projectId, workspaceId, deletedAt: null }, select: { id: true } });
    if (!live) continue;
    const found = hidden.has(ds.projectId!)
      ? await Promise.all((await visibleAppended(user, workspaceId, ds)).map((id) => loadProjectGrid(id)))
      : [(await loadCombinedGrid(user, workspaceId, ds.projectId!, ds)).grid];
    for (const g of found) if (g) grids.push(g);
  }
  return { grids, members };
}

/**
 * The tasks a dashboard's current slicers keep, over every source the viewer may see - the scope an
 * AI report's totals must use so they match the charts. `null` when no slicer is active (no narrowing).
 */
export async function dashboardScopeTaskIds(user: SessionUser, workspaceId: string, dashboardId: string, slicers: SlicerSelection[]): Promise<string[] | null> {
  if (!slicers.length) return null;
  const { grids, members } = await dashboardGrids(user, workspaceId, dashboardId);
  const ids = new Set<string>();
  for (const grid of grids) {
    const cond = slicerConditions(grid.records, grid.fields, members, slicers);
    const kept = cond.length ? applyFilters(grid.records, grid.fields, { conjunction: "AND", conditions: cond }) : grid.records;
    for (const r of kept) ids.add(r.id);
  }
  return [...ids];
}

/** Projects a widget reads from may at most be this many (main + appended + merged). */
const MAX_SOURCES = 10;

/**
 * The main project's grid, with appended projects stacked under it and a merged one joined in (U8b).
 * Sources hidden from the viewer are left out (counted in `hiddenSources`), but the widget keeps its
 * shape: the Project column stays, and merged columns become empty placeholders.
 */
async function loadCombinedGrid(user: SessionUser, workspaceId: string, projectId: string, ds: NonNullable<DashboardBlockConfig["dataSource"]>, hiddenMain: DashboardBlockConfig | null = null) {
  const loaded = await loadProjectGrid(projectId);
  // A main project hidden from the viewer gives only the shape the widget needs (see shapeOnly).
  const grid = loaded && hiddenMain ? { ...loaded, fields: await shapeOnly(loaded.fields, hiddenMain, await visibleAppended(user, workspaceId, ds)), records: [] } : loaded;
  const extra = [...(ds.appendProjectIds ?? []), ...(ds.merge ? [ds.merge.projectId] : [])];
  if (!grid || !extra.length) return { grid, hiddenSources: hiddenMain ? 1 : 0 };
  const hidden = await hiddenProjectIds(user);
  const projects = await prisma.project.findMany({ where: { id: { in: [projectId, ...extra].slice(0, MAX_SOURCES) }, workspaceId, deletedAt: null }, select: { id: true, name: true } });
  const nameOf = new Map(projects.filter((p) => !hidden.has(p.id)).map((p) => [p.id, p.name]));
  const hiddenSources = new Set(extra.filter((id) => id !== projectId && hidden.has(id))).size + (hiddenMain ? 1 : 0);
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
      // Placeholder columns with no values: nothing of the hidden project is read (rows, names, options).
      const placeholders = ds.merge.fieldIds.map((id, i): FieldRow => ({ id: `m:${id}`, projectId, name: `(hidden source) ${i + 1}`, type: "text", config: null, order: 10000 + i, isPrimary: false, visible: true, description: null, defaultValue: null, readOnly: true, system: false }));
      combined = { ...combined, fields: [...combined.fields, ...placeholders] };
    }
  }
  return { grid: { ...grid, fields: combined.fields, records: combined.records }, hiddenSources };
}

/** Appended projects of a widget the viewer may see, in widget order (merged ones need the main project's rows). */
async function visibleAppended(user: SessionUser, workspaceId: string, ds: NonNullable<DashboardBlockConfig["dataSource"]>): Promise<string[]> {
  const ids = (ds.appendProjectIds ?? []).filter((id) => id !== ds.projectId).slice(0, MAX_SOURCES);
  if (!ids.length) return [];
  const ok = new Set((await prisma.project.findMany({ where: { id: { in: ids }, workspaceId, deletedAt: null, ...visibleProjectWhere(user) }, select: { id: true } })).map((p) => p.id));
  return ids.filter((id) => ok.has(id));
}

/**
 * The columns a widget keeps when its main project is hidden from the viewer: the system fields and the
 * fields the widget config names (their names already show on the widget). Nothing else of the hidden
 * project is kept - no rows, and no field settings at all (options, objectives...): each column takes its
 * settings from the matching field of a project the viewer may see, or none.
 */
async function shapeOnly(fields: FieldRow[], config: DashboardBlockConfig, visibleIds: string[]): Promise<FieldRow[]> {
  const used = JSON.stringify(config);
  const visibleFields = (await Promise.all(visibleIds.map((id) => loadProjectGrid(id)))).flatMap((g) => g?.fields ?? []);
  const norm = (x: string) => x.trim().toLowerCase();
  return fields
    .filter((f) => f.id.startsWith("sys_") || used.includes(`"${f.id}"`))
    .map((f) => {
      const twin = visibleFields.find((o) => o.id === f.id) ?? visibleFields.find((o) => norm(o.name) === norm(f.name) && o.type === f.type);
      return { ...f, config: twin?.config ?? null, description: null, defaultValue: null };
    });
}

type RawSource = { projectId?: unknown; viewId?: unknown; appendProjectIds?: unknown; merge?: { projectId?: unknown } };
const dataSourceOf = (config: unknown) => (config as { dataSource?: RawSource } | null | undefined)?.dataSource;
/** Every project a widget config reads (main, appended, merged), as given. */
function sourceIdsOf(ds: RawSource | undefined): unknown[] {
  if (typeof ds?.projectId !== "string") return [];
  return [ds.projectId, ...(Array.isArray(ds.appendProjectIds) ? ds.appendProjectIds : []), ...(ds.merge ? [ds.merge.projectId] : [])];
}

/**
 * A widget may only point at projects of its own workspace that the author can see. When an editor
 * saves a widget another member built, sources hidden from the editor that the widget already had
 * (`previous`, the stored config) may stay: the editor can't see or remove them, and keeping them
 * reads nothing of those projects for the editor. New hidden sources are still refused.
 */
export async function assertWidgetSource(user: SessionUser, workspaceId: string, config: unknown, previous?: unknown) {
  const ds = dataSourceOf(config);
  const ids = sourceIdsOf(ds);
  if (!ids.length) return;
  const projectId = ids[0] as string;
  if (ids.length > MAX_SOURCES || ids.some((id) => typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))) throw new HttpError(400, "Unknown data source project");
  const found = await prisma.project.count({ where: { id: { in: ids as string[] }, workspaceId, deletedAt: null } });
  const hidden = await hiddenProjectIds(user);
  const kept = new Set(sourceIdsOf(dataSourceOf(previous)));
  if (found !== new Set(ids).size || ids.some((id) => hidden.has(id as string) && !kept.has(id))) throw new HttpError(400, "Unknown data source project");
  if (typeof ds?.viewId === "string" && !(await prisma.view.findFirst({ where: { id: ds.viewId, projectId }, select: { id: true } }))) throw new HttpError(400, "Unknown data source view");
}

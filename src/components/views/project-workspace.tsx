"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { api } from "@/lib/api-client";
import { onViewsChanged } from "@/lib/view-events";
import { toast } from "@/components/ui/toast";
import { promptDoneCheck } from "@/components/tasks/done-check-dialog";
import { ViewTabs } from "./view-tabs";
import { ViewToolbar } from "./view-toolbar";
import { GridView, type GridBulkChange } from "@/components/grid/grid-view";
import { TaskTransferDialog, type TaskTransferMode } from "@/components/tasks/task-transfer-dialog";
import { GanttView } from "@/components/gantt/gantt-view";
import { KanbanView } from "@/components/kanban/kanban-view";
import { CalendarView } from "@/components/calendar/calendar-view";
import { GalleryView, GallerySettings } from "@/components/gallery/gallery-view";
import { FormView } from "@/components/form/form-view";
import { RecordDrawer } from "@/components/grid/record-drawer";
import { FieldEditorDialog } from "@/components/fields/field-editor-dialog";
import { ExportDialog } from "./export-dialog";
import type { LinkTarget } from "@/components/grid/cell";
import { applyFilters, applySorts, applyGroup, getCellValue, type ViewConfig } from "@/lib/query-engine";
import { parseFieldConfig } from "@/lib/field-types";
import { groupFieldPatch } from "@/lib/grid-group";
import { orderVisibleFields } from "@/lib/grid-columns";
import { NewTaskDialog } from "@/components/tasks/new-task-dialog";
import { EisenhowerView } from "@/components/eisenhower/eisenhower-view";
import { ReportView } from "@/components/report/report-view";
import { ProjectHeader } from "@/components/projects/project-tabs";
import { useT } from "@/components/i18n-provider";
import type { MessageKey } from "@/lib/i18n/core";
import type { OkrOptions } from "@/components/grid/cell";
import type { FieldRow, RecordRow } from "@/types";
import { ProjectAiChat } from "@/components/ai/project-ai-chat";
import { cn } from "@/lib/utils";
import { MetaStatus } from "@/components/ui/meta";
import { fieldActions, viewActions, type ProjectDetail } from "./project-actions";

const ROLE_RANK: Record<string, number> = { viewer: 0, contributor: 1, editor: 2, admin: 3, owner: 4 };

export function ProjectWorkspace({ projectId, breadcrumb }: { projectId: string; breadcrumb: { workspace: string; project: string } }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { t } = useT();
  const { data: session } = useSession();
  const currentUserId = (session?.user as { id?: string } | undefined)?.id;
  const [table, setTable] = useState<ProjectDetail | null>(null);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [activeViewId, setActiveViewId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [openRecordId, setOpenRecordId] = useState<string | null>(searchParams.get("record"));
  /** A task just added from the toolbar: the grid focuses its name cell once it is on screen. */
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);
  /** The toolbar's "+ New task" form (null = closed). */
  const [newTask, setNewTask] = useState<{ initialData: Record<string, unknown> } | null>(null);
  const [fieldDialog, setFieldDialog] = useState<{ open: boolean; field: FieldRow | null; insertAfterOrder?: number }>({ open: false, field: null });
  const [exportOpen, setExportOpen] = useState(false);
  const [okrOptions, setOkrOptions] = useState<OkrOptions>({ objectives: [], keyResults: [] });
  const [loading, setLoading] = useState(true);
  const [aiSidebar, setAiSidebar] = useState(false);
  const [transfer, setTransfer] = useState<{ mode: TaskTransferMode; ids: string[] } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [detail, recs] = await Promise.all([
        api.get<ProjectDetail>(`/api/projects/${projectId}`),
        api.get<RecordRow[]>(`/api/projects/${projectId}/tasks`),
      ]);
      setTable(detail);
      setRecords(recs);
      const requestedViewId = searchParams.get("view");
      const requestedViewValid = requestedViewId && detail.views.some((v) => v.id === requestedViewId);
      setActiveViewId((prev) => (requestedViewValid ? requestedViewId! : prev || detail.views.find((v) => v.isDefault)?.id || detail.views[0]?.id || ""));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-fetch everything when the project changes; the view-param sync effect below reacts to searchParams on its own
  }, [projectId]);

  // Sidebar links to a specific view via ?view= - sync it in without a full table re-fetch
  // when only the view changes (same table).
  useEffect(() => {
    const requestedViewId = searchParams.get("view");
    if (requestedViewId && table?.views.some((v) => v.id === requestedViewId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing local view selection to the URL is exactly what this effect is for
      setActiveViewId(requestedViewId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, table?.id]);

  // Views changed from the sidebar: refresh our tabs (records are untouched).
  useEffect(
    () =>
      onViewsChanged(projectId, async () => {
        try {
          const detail = await api.get<ProjectDetail>(`/api/projects/${projectId}`);
          setTable((t) => (t ? { ...t, views: detail.views } : t));
          setActiveViewId((prev) => (detail.views.some((v) => v.id === prev) ? prev : detail.views.find((v) => v.isDefault)?.id || detail.views[0]?.id || ""));
        } catch {
          // keep the current tabs
        }
      }),
    [projectId]
  );
  /** Our tab changes → re-render the server sidebar. */
  const syncSidebar = () => router.refresh();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetching table data on mount / table change is exactly what this effect is for
    load();
    setActiveViewId("");
    setSelectedIds(new Set());
  }, [load]);

  // Live Objective/Key Result options for `okr_objective`/`okr_key_result` cell pickers.
  useEffect(() => {
    if (!table) return;
    api
      .get<OkrOptions>(`/api/workspaces/${table.workspace.id}/okr-options`)
      .then(setOkrOptions)
      .catch(() => {});
  }, [table]);

  const activeView = table?.views.find((v) => v.id === activeViewId);
  const config: ViewConfig = useMemo(() => (activeView ? JSON.parse(activeView.config || "{}") : {}), [activeView]);

  function persistViewConfig(next: ViewConfig) {
    if (!activeView) return;
    setTable((t) => (t ? { ...t, views: t.views.map((v) => (v.id === activeView.id ? { ...v, config: JSON.stringify(next) } : v)) } : t));
    // Below editor, filters / sorts apply for this visit only: shared views are changed by editors.
    if (!canEdit) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api.patch(`/api/views/${activeView.id}`, { config: next }).catch(() => toast.error(t("common.failed")));
    }, 400);
  }

  function updateConfig(patch: Partial<ViewConfig>) {
    persistViewConfig({ ...config, ...patch });
  }

  const fields = useMemo(() => table?.fields ?? [], [table]);
  // Rights in this project (the server enforces them; this only shapes the UI).
  const caps = useMemo(() => new Set(table?.myPermissions ?? []), [table]);
  const canEdit = (ROLE_RANK[table?.myRole ?? ""] ?? -1) >= ROLE_RANK.editor && caps.has("views.manage");
  const canFields = caps.has("fields.manage");

  // "Depends On" / "Parent Task" pick from this project's own tasks.
  const linkTargets = useMemo(() => {
    const target: LinkTarget = { records: records.map((r) => ({ id: r.id, label: String(r.data.sys_title ?? "") || t("task.untitled") })) };
    const out: Record<string, LinkTarget> = {};
    for (const f of fields) if (f.type === "link") out[f.id] = target;
    return out;
  }, [records, fields, t]);
  const members = useMemo(() => table?.members ?? [], [table]);

  const searched = useMemo(() => {
    if (!search.trim()) return records;
    const q = search.toLowerCase();
    return records.filter((r) => fields.some((f) => String(getCellValue(r, f, fields) ?? "").toLowerCase().includes(q)));
  }, [records, search, fields]);

  const filtered = useMemo(
    () => applyFilters(searched, fields, config.filters, currentUserId),
    [searched, fields, config.filters, currentUserId]
  );
  const sorted = useMemo(() => applySorts(filtered, fields, config.sorts), [filtered, fields, config.sorts]);
  const groups = useMemo(() => applyGroup(sorted, fields, config.group, members), [sorted, fields, config.group, members]);
  const reorderable = (!config.sorts || config.sorts.length === 0) && !config.group?.fieldId && !search.trim() && !config.filters?.conditions?.length;

  async function handleCellChange(recordId: string, fieldId: string, value: unknown) {
    return handleCellChangeMultiple(recordId, { [fieldId]: value });
  }

  // Setting more than one field on the same record at once (e.g. Eisenhower
  // drag-drop writing Importance + Urgency together) must go through a single
  // request: two concurrent handleCellChange calls would each read-merge
  // against the same stale server row and the second write would clobber the
  // first.
  async function handleCellChangeMultiple(recordId: string, patch: Record<string, unknown>) {
    setRecords((prev) => prev.map((r) => (r.id === recordId ? { ...r, data: { ...r.data, ...patch } } : r)));
    // Attachments are saved by their own upload/delete endpoints; the grid only mirrors the new list.
    if (Object.keys(patch).every((k) => k === "sys_attachments")) return;
    try {
      // The server normalizes values (e.g. a "done" status sets progress to 100) - adopt its version.
      const saved = await api.patch<RecordRow>(`/api/tasks/${recordId}`, { data: patch });
      setRecords((prev) => prev.map((r) => (r.id === recordId ? saved : r)));
      promptDoneCheck(saved, (rec) => setRecords((prev) => prev.map((r) => (r.id === rec.id ? rec : r))));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
      load();
    }
  }

  /**
   * Paste / fill down: many rows at once. Updates go out a few at a time; new rows are created in order
   * so they keep the pasted order. One summary toast and one reload instead of one per failed row.
   */
  async function handleBulkChange({ updates, creates }: GridBulkChange) {
    const patches = new Map(updates.map((u) => [u.recordId, u.patch]));
    setRecords((prev) => prev.map((r) => (patches.has(r.id) ? { ...r, data: { ...r.data, ...patches.get(r.id) } } : r)));
    let updated = 0;
    let created = 0;
    const errors: string[] = [];
    const queue = [...updates];
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        try {
          const saved = await api.patch<RecordRow>(`/api/tasks/${next.recordId}`, { data: next.patch });
          setRecords((prev) => prev.map((r) => (r.id === saved.id ? saved : r)));
          updated++;
        } catch (e) {
          errors.push(e instanceof Error ? e.message : t("common.failed"));
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
    if (creates.length && !caps.has("task.create")) toast.info(t("pp.noCreate"));
    else {
      for (const data of creates) {
        try {
          const record = await api.post<RecordRow>(`/api/projects/${projectId}/tasks`, { data });
          setRecords((prev) => [...prev, record]);
          created++;
        } catch (e) {
          errors.push(e instanceof Error ? e.message : t("common.failed"));
        }
      }
    }
    if (errors.length) {
      toast.error(t("grid.pasteFailed", { n: errors.length, reason: errors[0] }));
      load();
    }
    return { updated, created, failed: errors.length };
  }

  async function handleAddRecord(initialData?: Record<string, unknown>) {
    if (!caps.has("task.create")) return void toast.info(t("pp.noCreate"));
    try {
      const record = await api.post<RecordRow>(`/api/projects/${projectId}/tasks`, { data: initialData ?? {} });
      setRecords((prev) => [...prev, record]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  /** Grid "Insert rows": new tasks right above / below a task, in its group and at its level. */
  async function handleInsertRows(anchorId: string, position: "above" | "below", count: number, data: Record<string, unknown>, quiet = false): Promise<RecordRow[]> {
    if (!caps.has("task.create")) {
      toast.info(t("pp.noCreate"));
      return [];
    }
    try {
      const { records: created } = await api.post<{ records: RecordRow[] }>(`/api/projects/${projectId}/tasks/insert`, { anchorId, position, count, data });
      setRecords((prev) => {
        const at = prev.findIndex((r) => r.id === anchorId);
        if (at < 0) return [...prev, ...created];
        // Mirror the server: rows after the insertion point (the anchor too for "above") move down by
        // count + 1, the new rows take the orders right after the anchor's.
        const anchorOrder = prev[at].order;
        const shift = count + 1;
        const moved = prev.map((r, i) => {
          const after = r.order > anchorOrder || (r.order === anchorOrder && (position === "above" ? i >= at : i > at));
          return after ? { ...r, order: r.order + shift } : r;
        });
        const index = position === "above" ? at : at + 1;
        return [...moved.slice(0, index), ...created, ...moved.slice(index)];
      });
      if (!quiet) toast.success(t("grid.inserted", { n: created.length }));
      return created;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
      load();
      return [];
    }
  }

  /** Where a task from the toolbar's "+ New task" goes: above the first top-level task the view shows (first group when grouped). */
  function newTaskSlot() {
    const firstGroup = groups?.[0];
    const pool = firstGroup ? firstGroup.records : sorted;
    const anchor = pool.find((r) => !((r.data.sys_parent as string[] | undefined) ?? []).length);
    const groupField = firstGroup && config.group?.fieldId ? fields.find((f) => f.id === config.group?.fieldId) : undefined;
    const data = groupField && firstGroup && anchor ? (groupFieldPatch(groupField, firstGroup.key, getCellValue(anchor, groupField, fields)) ?? {}) : {};
    return { anchor, data };
  }

  /** Toolbar "+ New task": opens the form with the table's columns (pre-filled with the first group's value). */
  function openNewTask() {
    if (!caps.has("task.create")) return void toast.info(t("pp.noCreate"));
    setNewTask({ initialData: newTaskSlot().data });
  }

  /** Saves the form: the task goes to the top of the view, then the grid scrolls to it. */
  async function submitNewTask(data: Record<string, unknown>): Promise<boolean> {
    const { anchor } = newTaskSlot();
    if (!anchor) {
      try {
        const record = await api.post<RecordRow>(`/api/projects/${projectId}/tasks`, { data });
        setRecords((prev) => [...prev, record]);
        setFocusTaskId(record.id);
        toast.success(t("ntd.added"));
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t("common.failed"));
        return false;
      }
    }
    const [created] = await handleInsertRows(anchor.id, "above", 1, data, true);
    if (!created) return false;
    setFocusTaskId(created.id);
    toast.success(t("ntd.added"));
    return true;
  }

  /** Grid "Delete rows" (the grid already asked for confirmation). Sub-tasks of deleted tasks stay. */
  async function handleDeleteRecords(ids: string[]) {
    const gone = new Set(ids);
    setRecords((prev) => prev.filter((r) => !gone.has(r.id)));
    setSelectedIds((prev) => new Set([...prev].filter((id) => !gone.has(id))));
    if (openRecordId && gone.has(openRecordId)) setOpenRecordId(null);
    try {
      await api.post(`/api/projects/${projectId}/tasks/bulk-delete`, { ids });
      toast.success(t("grid.deleted", { n: ids.length }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
      load();
    }
  }

  async function handleDeleteRecord(id: string) {
    setRecords((prev) => prev.filter((r) => r.id !== id));
    setOpenRecordId(null);
    try {
      await api.delete(`/api/tasks/${id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
      load();
    }
  }

  async function handleBulkDelete() {
    const ids = [...selectedIds];
    setRecords((prev) => prev.filter((r) => !selectedIds.has(r.id)));
    setSelectedIds(new Set());
    try {
      await api.post(`/api/projects/${projectId}/tasks/bulk-delete`, { ids });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
      load();
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleSelectAll(ids: string[]) {
    setSelectedIds((prev) => (ids.every((id) => prev.has(id)) ? new Set() : new Set(ids)));
  }

  const { handleAddField, handleFieldAction, handleFieldSave, handleReorderFields, handleResizeColumn } = fieldActions({ projectId, t, fields, canFields, config, updateConfig, load, setTable, fieldDialog, setFieldDialog });

  async function handleReorderRecords(orderedIds: string[]) {
    const map = new Map(orderedIds.map((id, i) => [id, i]));
    setRecords((prev) => [...prev].sort((a, b) => (map.get(a.id) ?? 0) - (map.get(b.id) ?? 0)));
    try {
      await Promise.all(orderedIds.map((id, i) => api.patch(`/api/tasks/${id}`, { order: i })));
    } catch {
      toast.error(t("common.failed"));
    }
  }

  const { handleCreateView, handleRenameView, handleDeleteView, handleSaveAsView, handleDuplicateView, handleReorderViews, handleTogglePublic } = viewActions({ projectId, t, table, setTable, activeView, setActiveViewId, syncSidebar });

  const openRecord = records.find((r) => r.id === openRecordId);
  const openPage = (id: string) => table && router.push(`/w/${table.workspace.slug}/p/${projectId}/t/${id}`);

  if (loading && !table) {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-400 text-sm">{t("common.loading")}</div>
    );
  }
  if (!table) return null;

  return (
    <div className={cn("flex-1 flex flex-col overflow-hidden", aiSidebar && "sm:pr-[420px]")}>
      <ProjectHeader
        workspaceSlug={table.workspace.slug}
        workspaceName={breadcrumb.workspace}
        projectId={projectId}
        projectName={breadcrumb.project}
        right={
          <>
            <span className="whitespace-nowrap">{t("project.tasksCount", { count: records.length })}</span><MetaStatus className="ml-2 hidden sm:inline-flex whitespace-nowrap">{t(`role.${table.myRole}` as MessageKey)}</MetaStatus>
          </>
        }
      />

      <ViewTabs
        views={table.views}
        activeId={activeViewId}
        onSelect={setActiveViewId}
        onCreate={handleCreateView}
        onRename={handleRenameView}
        onDelete={handleDeleteView}
        onDuplicate={handleDuplicateView}
        onReorder={handleReorderViews}
        canManage={canEdit}
        canCreate={caps.has("views.create")}
        trailing={activeView?.type === "gallery" ? <ViewToolbar
          inline
          fields={fields}
          config={config}
          members={members}
          search={search}
          onSearchChange={setSearch}
          onConfigChange={updateConfig}
          selectedCount={selectedIds.size}
          onBulkDelete={handleBulkDelete}
          onTransfer={(mode) => setTransfer({ mode, ids: [...selectedIds] })}
          onClearSelection={() => setSelectedIds(new Set())}
          onExportClick={() => setExportOpen(true)}
          onSaveAsView={handleSaveAsView}
          viewType={activeView?.type ?? "grid"}
          extra={activeView?.type === "gallery" ? <GallerySettings fields={fields} config={config.gallery ?? {}} onChange={(patch) => updateConfig({ gallery: { ...(config.gallery ?? {}), ...patch } })} /> : undefined}
        /> : undefined}
      />

      {activeView?.type !== "form" && activeView?.type !== "gallery" && (
        <ViewToolbar
          onNewTask={(activeView?.type ?? "grid") === "grid" && caps.has("task.create") ? openNewTask : undefined}
          fields={fields}
          config={config}
          members={members}
          search={search}
          onSearchChange={setSearch}
          onConfigChange={updateConfig}
          selectedCount={selectedIds.size}
          onBulkDelete={handleBulkDelete}
          onTransfer={(mode) => setTransfer({ mode, ids: [...selectedIds] })}
          onClearSelection={() => setSelectedIds(new Set())}
          onExportClick={() => setExportOpen(true)}
          onSaveAsView={handleSaveAsView}
          viewType={activeView?.type ?? "grid"}
          extra={activeView?.type === "gallery" ? <GallerySettings fields={fields} config={config.gallery ?? {}} onChange={(patch) => updateConfig({ gallery: { ...(config.gallery ?? {}), ...patch } })} /> : undefined}
        />
      )}

      {activeView?.type === "kanban" ? (
        <KanbanView
          fields={fields}
          flatRecords={sorted}
          members={members}
          config={config.kanban ?? {}}
          onConfigChange={(patch) => updateConfig({ kanban: { ...(config.kanban ?? {}), ...patch } })}
          onCellChange={handleCellChange}
          onOpenRecord={setOpenRecordId}
          onOpenPage={openPage}
          onAddRecord={handleAddRecord}
        />
      ) : activeView?.type === "calendar" ? (
        <CalendarView
          fields={fields}
          flatRecords={sorted}
          members={members}
          config={config.calendar ?? {}}
          onConfigChange={(patch) => updateConfig({ calendar: { ...(config.calendar ?? {}), ...patch } })}
          onCellChange={handleCellChange}
          onOpenRecord={setOpenRecordId}
        />
      ) : activeView?.type === "gallery" ? (
        <GalleryView
          fields={fields}
          flatRecords={sorted}
          members={members}
          config={config.gallery ?? {}}
          canEdit={canEdit}
          onOpenRecord={setOpenRecordId}
          onOpenPage={openPage}
          onRecordUpdated={(rec) => setRecords((prev) => prev.map((r) => (r.id === rec.id ? rec : r)))}
          onDeleteRecord={(id) => confirm(t("record.deleteConfirm")) && handleDeleteRecord(id)}
        />
      ) : activeView?.type === "form" ? (
        <FormView
          view={activeView}
          tableName={table.name}
          fields={fields}
          members={members}
          config={config.form ?? {}}
          onConfigChange={(patch) => updateConfig({ form: { ...(config.form ?? {}), ...patch } })}
          onTogglePublic={handleTogglePublic}
          publicUrl={typeof window !== "undefined" ? `${window.location.origin}/form/${activeView.id}` : ""}
          onSubmitRecord={(data) => handleAddRecord(data)}
        />
      ) : activeView?.type === "gantt" ? (
        <GanttView
          fields={fields}
          groups={groups}
          flatRecords={sorted}
          members={members}
          linkTargets={linkTargets}
          config={config.ganttConfig ?? {}}
          onConfigChange={(patch) => updateConfig({ ganttConfig: { ...(config.ganttConfig ?? {}), ...patch } })}
          onCellChange={handleCellChange}
          onOpenRecord={setOpenRecordId}
          onOpenPage={openPage}
        />
      ) : activeView?.type === "report" ? (
        <ReportView workspaceId={table.workspace.id} projectId={projectId} fields={fields} records={sorted} members={members} config={config.report ?? {}} canEdit={canEdit} onConfigChange={(next) => updateConfig({ report: next })} onOpenRecord={setOpenRecordId} />
      ) : activeView?.type === "eisenhower" ? (
        <EisenhowerView
          fields={fields}
          flatRecords={sorted}
          members={members}
          config={config.eisenhower ?? {}}
          onConfigChange={(patch) => updateConfig({ eisenhower: { ...(config.eisenhower ?? {}), ...patch } })}
          onCellChange={handleCellChange}
          onCellChangeMultiple={handleCellChangeMultiple}
          onOpenRecord={setOpenRecordId}
          onOpenPage={openPage}
          okrOptions={okrOptions}
        />
      ) : (
        <GridView
          fields={fields}
          groups={groups}
          flatRecords={sorted}
          members={members}
          linkTargets={linkTargets}
          okrOptions={okrOptions}
          hiddenFieldIds={config.hiddenFieldIds ?? []}
          columnOrder={config.columnOrder ?? []}
          columnWidths={config.columnWidths ?? {}}
          frozenCount={config.frozenCount ?? 1}
          rowHeight={config.rowHeight ?? "medium"}
          conditionalFormats={config.conditionalFormats ?? []}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onToggleSelectAll={toggleSelectAll}
          onCellChange={handleCellChange}
          onBulkChange={handleBulkChange}
          onTransferTasks={(ids, mode) => setTransfer({ mode, ids })}
          onAddRecord={handleAddRecord}
          onInsertRows={caps.has("task.create") ? async (anchorId, position, count, data) => void (await handleInsertRows(anchorId, position, count, data)) : undefined}
          focusRecordId={focusTaskId}
          onFocused={() => setFocusTaskId(null)}
          onDeleteRecords={caps.has("task.delete") ? handleDeleteRecords : undefined}
          groupFieldId={config.group?.fieldId || undefined}
          onOpenRecord={setOpenRecordId}
          onOpenPage={openPage}
          onAddField={canFields ? handleAddField : () => toast.info(t("pp.noFields"))}
          onFieldAction={handleFieldAction}
          onReorderFields={handleReorderFields}
          onResizeColumn={handleResizeColumn}
          onReorderRecords={handleReorderRecords}
          reorderable={reorderable}
        />
      )}

      {openRecord && (
        <RecordDrawer
          record={openRecord}
          canEdit={(ROLE_RANK[table.myRole] ?? -1) >= ROLE_RANK.contributor}
          fields={fields}
          members={members}
          linkTargets={linkTargets}
          okrOptions={okrOptions}
          pageHref={`/w/${table.workspace.slug}/p/${projectId}/t/${openRecord.id}`}
          currentUserId={currentUserId}
          onClose={() => setOpenRecordId(null)}
          onTaskCreated={(record) => {
            // A task created from a comment into this project shows up in the grid right away.
            if (record.projectId === projectId) setRecords((prev) => (prev.some((r) => r.id === record.id) ? prev : [...prev, record]));
          }}
          tasks={records}
          onUpdateTask={(id, patch) => void handleCellChangeMultiple(id, patch)}
          onOpenFull={openPage}
          canCreate={caps.has("task.create")}
          onOpenTask={setOpenRecordId}
          onAddSubtask={async (title) => {
            try {
              const record = await api.post<RecordRow>(`/api/projects/${projectId}/tasks`, { data: { sys_title: title, sys_parent: [openRecord.id] } });
              setRecords((prev) => [...prev, record]);
              toast.success(t("th.added"));
            } catch (e) {
              toast.error(e instanceof Error ? e.message : t("common.failed"));
              throw e;
            }
          }}
          onChange={(fieldId, value) => handleCellChange(openRecord.id, fieldId, value)}
          onDelete={() => {
            if (confirm(t("record.deleteConfirm"))) handleDeleteRecord(openRecord.id);
          }}
        />
      )}

      {newTask ? (
        <NewTaskDialog
          open
          onOpenChange={(open) => !open && setNewTask(null)}
          fields={orderVisibleFields(fields, config.columnOrder ?? [], config.hiddenFieldIds ?? [])}
          allFields={fields}
          members={members}
          linkTargets={linkTargets}
          okrOptions={okrOptions}
          initialData={newTask.initialData}
          onSubmit={submitNewTask}
        />
      ) : null}

      <FieldEditorDialog
        open={fieldDialog.open}
        onOpenChange={(v) => setFieldDialog((d) => ({ ...d, open: v }))}
        field={fieldDialog.field ? { name: fieldDialog.field.name, type: fieldDialog.field.type, description: fieldDialog.field.description, config: parseFieldConfig(fieldDialog.field.config) } : null}
        availableFields={fields}
        onSave={handleFieldSave}
      />

      <ProjectAiChat
        projectId={projectId}
        projectName={breadcrumb.project}
        onTaskCreated={(record, pid) => {
          if (pid === projectId) setRecords((prev) => (prev.some((r) => r.id === record.id) ? prev : [...prev, record]));
        }}
        onTaskUpdated={(rec) => setRecords((prev) => prev.map((r) => (r.id === rec.id ? rec : r)))}
        onOpenTask={setOpenRecordId}
        onSidebarChange={setAiSidebar}
      />

      {transfer && table ? (
        <TaskTransferDialog
          open
          onOpenChange={(open) => !open && setTransfer(null)}
          initialMode={transfer.mode}
          taskIds={transfer.ids}
          sourceProjectId={projectId}
          workspaceId={table.workspace.id}
          onDone={() => {
            // Moved tasks (and their sub-tasks) leave this grid; copies into this project appear.
            setSelectedIds(new Set());
            load();
            syncSidebar();
          }}
        />
      ) : null}

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        tableName={table.name}
        allFields={fields}
        visibleFields={fields.filter((f) => !(config.hiddenFieldIds ?? []).includes(f.id))}
        allRecords={records}
        filteredRecords={sorted}
        selectedRecords={records.filter((r) => selectedIds.has(r.id))}
        members={members}
      />
    </div>
  );
}

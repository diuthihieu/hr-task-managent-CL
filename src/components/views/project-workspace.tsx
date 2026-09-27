"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { ChevronRight } from "lucide-react";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { nanoid } from "nanoid";
import { ViewTabs } from "./view-tabs";
import { ViewToolbar } from "./view-toolbar";
import { GridView } from "@/components/grid/grid-view";
import { GanttView } from "@/components/gantt/gantt-view";
import { KanbanView } from "@/components/kanban/kanban-view";
import { CalendarView } from "@/components/calendar/calendar-view";
import { GalleryView } from "@/components/gallery/gallery-view";
import { FormView } from "@/components/form/form-view";
import { RecordDrawer } from "@/components/grid/record-drawer";
import { FieldEditorDialog, type FieldDraft } from "@/components/fields/field-editor-dialog";
import { ExportDialog } from "./export-dialog";
import type { LinkTarget, Member } from "@/components/grid/cell";
import { applyFilters, applySorts, applyGroup, getCellValue, type ViewConfig, type FilterCondition } from "@/lib/query-engine";
import { parseFieldConfig, getFieldType } from "@/lib/field-types";
import { EisenhowerView } from "@/components/eisenhower/eisenhower-view";
import type { OkrOptions } from "@/components/grid/cell";
import type { FieldRow, RecordRow, ViewRow } from "@/types";

interface ProjectDetail {
  id: string;
  name: string;
  fields: FieldRow[];
  views: ViewRow[];
  members: Member[];
  myRole: string;
  workspace: { id: string; slug: string; name: string };
}

const ROLE_RANK: Record<string, number> = { viewer: 0, contributor: 1, editor: 2, admin: 3, owner: 4 };

export function ProjectWorkspace({ projectId, breadcrumb }: { projectId: string; breadcrumb: { workspace: string; project: string } }) {
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const currentUserId = (session?.user as { id?: string } | undefined)?.id;
  const [table, setTable] = useState<ProjectDetail | null>(null);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [activeViewId, setActiveViewId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [openRecordId, setOpenRecordId] = useState<string | null>(searchParams.get("record"));
  const [fieldDialog, setFieldDialog] = useState<{ open: boolean; field: FieldRow | null; insertAfterOrder?: number }>({ open: false, field: null });
  const [exportOpen, setExportOpen] = useState(false);
  const [okrOptions, setOkrOptions] = useState<OkrOptions>({ objectives: [], keyResults: [] });
  const [loading, setLoading] = useState(true);
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
      toast.error(e instanceof Error ? e.message : "Failed to load project");
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
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api.patch(`/api/views/${activeView.id}`, { config: next }).catch(() => toast.error("Failed to save view"));
    }, 400);
  }

  function updateConfig(patch: Partial<ViewConfig>) {
    persistViewConfig({ ...config, ...patch });
  }

  const fields = useMemo(() => table?.fields ?? [], [table]);
  const canEdit = (ROLE_RANK[table?.myRole ?? ""] ?? -1) >= ROLE_RANK.editor;

  // "Depends On" / "Parent Task" pick from this project's own tasks.
  const linkTargets = useMemo(() => {
    const target: LinkTarget = { records: records.map((r) => ({ id: r.id, label: String(r.data.sys_title ?? "") || "Untitled task" })) };
    const out: Record<string, LinkTarget> = {};
    for (const f of fields) if (f.type === "link") out[f.id] = target;
    return out;
  }, [records, fields]);
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
    try {
      // The server normalizes values (e.g. a "done" status sets progress to 100) - adopt its version.
      const saved = await api.patch<RecordRow>(`/api/tasks/${recordId}`, { data: patch });
      setRecords((prev) => prev.map((r) => (r.id === recordId ? saved : r)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save change");
      load();
    }
  }

  async function handleAddRecord(initialData?: Record<string, unknown>) {
    try {
      const record = await api.post<RecordRow>(`/api/projects/${projectId}/tasks`, { data: initialData ?? {} });
      setRecords((prev) => [...prev, record]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add task");
    }
  }

  async function handleDeleteRecord(id: string) {
    setRecords((prev) => prev.filter((r) => r.id !== id));
    setOpenRecordId(null);
    try {
      await api.delete(`/api/tasks/${id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete task");
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
      toast.error(e instanceof Error ? e.message : "Failed to delete tasks");
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

  async function handleAddField(_afterFieldId: string | undefined, type: string) {
    const typeDef = getFieldType(type);
    const defaultConfig = ["single_select", "multi_select"].includes(type) ? { options: [{ id: crypto.randomUUID(), label: "Option 1", color: "#3b82f6" }] } : {};
    try {
      const created = await api.post<{ id: string }>(`/api/projects/${projectId}/custom-fields`, { name: typeDef.label, type, config: defaultConfig });
      const detail = await api.get<ProjectDetail>(`/api/projects/${projectId}`);
      setTable(detail);
      setFieldDialog({ open: true, field: detail.fields.find((f) => f.id === created.id) ?? null });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add field");
    }
  }

  async function createCustomField(body: { name: string; type: string; config?: object }) {
    try {
      await api.post(`/api/projects/${projectId}/custom-fields`, body);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create field");
    }
  }

  async function handleFieldAction(fieldId: string, action: string) {
    const field = fields.find((f) => f.id === fieldId);
    if (!field) return;
    const idx = fields.findIndex((f) => f.id === fieldId);

    if (action.startsWith("type:")) {
      toast.info("A field's type can't be changed once created - add a new field instead");
      return;
    }

    switch (action) {
      case "edit":
      case "description":
        if (field.system) {
          toast.info(field.id === "sys_status" || field.id === "sys_category" ? "Manage statuses and categories in Settings → Task Configuration" : "Built-in task fields can't be edited");
          return;
        }
        setFieldDialog({ open: true, field });
        return;
      case "conditional_format": {
        const ops = field.type;
        updateConfig({
          conditionalFormats: [
            ...(config.conditionalFormats ?? []),
            { id: nanoid(8), fieldId, operator: ops === "checkbox" ? "equals" : "equals", target: "cell", color: "#f97316" },
          ],
        });
        toast.info("Rule added — refine it from the Colors menu");
        return;
      }
      case "duplicate":
        if (field.system) {
          toast.info("Built-in task fields can't be duplicated");
          return;
        }
        await createCustomField({ name: `${field.name} copy`, type: field.type, config: { ...parseFieldConfig(field.config), options: parseFieldConfig(field.config).options?.map((o) => ({ label: o.label, color: o.color })) } });
        return;
      case "hide":
        updateConfig({ hiddenFieldIds: [...(config.hiddenFieldIds ?? []), fieldId] });
        return;
      case "insert_left":
      case "insert_right":
        await createCustomField({ name: "New Field", type: "text" });
        return;
      case "freeze":
        updateConfig({ frozenCount: idx + 1 });
        return;
      case "sort_asc":
        updateConfig({ sorts: [{ fieldId, direction: "asc" }] });
        return;
      case "sort_desc":
        updateConfig({ sorts: [{ fieldId, direction: "desc" }] });
        return;
      case "group":
        updateConfig({ group: { fieldId } });
        return;
      case "filter": {
        const cond: FilterCondition = { id: nanoid(8), fieldId, operator: "contains" };
        updateConfig({ filters: { conjunction: "AND", conditions: [...(config.filters?.conditions ?? []), cond] } });
        return;
      }
      case "delete":
        if (field.system) {
          toast.info("Built-in task fields can't be deleted - hide the column instead");
          return;
        }
        if (!confirm(`Delete field "${field.name}"? It disappears from every view (values are kept in the database).`)) return;
        try {
          await api.delete(`/api/custom-fields/${fieldId}`);
          load();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Failed to delete field");
        }
        return;
    }
  }

  async function handleFieldSave(draft: FieldDraft) {
    const target = fieldDialog.field;
    try {
      if (target) {
        await api.patch(`/api/custom-fields/${target.id}`, { name: draft.name, description: draft.description || null, config: draft.config });
      }
      setFieldDialog({ open: false, field: null });
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save field");
    }
  }

  async function handleReorderFields(orderedIds: string[]) {
    updateConfig({ columnOrder: orderedIds });
  }

  function handleResizeColumn(fieldId: string, width: number) {
    updateConfig({ columnWidths: { ...(config.columnWidths ?? {}), [fieldId]: width } });
  }

  async function handleReorderRecords(orderedIds: string[]) {
    const map = new Map(orderedIds.map((id, i) => [id, i]));
    setRecords((prev) => [...prev].sort((a, b) => (map.get(a.id) ?? 0) - (map.get(b.id) ?? 0)));
    try {
      await Promise.all(orderedIds.map((id, i) => api.patch(`/api/tasks/${id}`, { order: i })));
    } catch {
      toast.error("Failed to reorder");
    }
  }

  async function handleCreateView(name: string, type: string) {
    try {
      const view = await api.post<ViewRow>(`/api/projects/${projectId}/views`, { name, type });
      setTable((t) => (t ? { ...t, views: [...t.views, view] } : t));
      setActiveViewId(view.id);
    } catch {
      toast.error("Failed to create view");
    }
  }
  async function handleRenameView(id: string, name: string) {
    setTable((t) => (t ? { ...t, views: t.views.map((v) => (v.id === id ? { ...v, name } : v)) } : t));
    api.patch(`/api/views/${id}`, { name }).catch(() => {});
  }
  async function handleDeleteView(id: string) {
    try {
      await api.delete(`/api/views/${id}`);
      setTable((t) => (t ? { ...t, views: t.views.filter((v) => v.id !== id) } : t));
      setActiveViewId((prev) => (prev === id ? table?.views.find((v) => v.id !== id)?.id ?? "" : prev));
    } catch {
      toast.error("Failed to delete view");
    }
  }
  async function handleSaveAsView() {
    if (!activeView) return;
    const name = prompt("Name for this saved view", `${activeView.name} (filtered)`);
    if (!name) return;
    try {
      const view = await api.post<ViewRow>(`/api/projects/${projectId}/views`, {
        name,
        type: activeView.type,
        config: JSON.parse(activeView.config || "{}"),
      });
      setTable((t) => (t ? { ...t, views: [...t.views, view] } : t));
      setActiveViewId(view.id);
      toast.success(`Saved as "${name}"`);
    } catch {
      toast.error("Failed to save view");
    }
  }

  async function handleDuplicateView(id: string) {
    const source = table?.views.find((v) => v.id === id);
    if (!source) return;
    try {
      const view = await api.post<ViewRow>(`/api/projects/${projectId}/views`, {
        name: `${source.name} copy`,
        type: source.type,
        config: JSON.parse(source.config || "{}"),
      });
      setTable((t) => (t ? { ...t, views: [...t.views, view] } : t));
      setActiveViewId(view.id);
    } catch {
      toast.error("Failed to duplicate view");
    }
  }
  async function handleReorderViews(orderedIds: string[]) {
    const map = new Map(orderedIds.map((id, i) => [id, i]));
    setTable((t) => (t ? { ...t, views: [...t.views].sort((a, b) => (map.get(a.id) ?? 0) - (map.get(b.id) ?? 0)) } : t));
    try {
      await Promise.all(orderedIds.map((id, i) => api.patch(`/api/views/${id}`, { order: i })));
    } catch {
      toast.error("Failed to reorder views");
    }
  }
  async function handleTogglePublic(isPublic: boolean) {
    if (!activeView) return;
    setTable((t) => (t ? { ...t, views: t.views.map((v) => (v.id === activeView.id ? { ...v, isPublic } : v)) } : t));
    try {
      await api.patch(`/api/views/${activeView.id}`, { isPublic });
    } catch {
      toast.error("Failed to update public link");
    }
  }

  const openRecord = records.find((r) => r.id === openRecordId);

  if (loading && !table) {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-400 text-sm">Loading project…</div>
    );
  }
  if (!table) return null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-1.5 h-12 px-4 border-b border-neutral-200 dark:border-neutral-800 shrink-0 text-sm">
        <span className="text-neutral-400">{breadcrumb.workspace}</span>
        <ChevronRight size={13} className="text-neutral-300" />
        <span className="font-medium text-neutral-800 dark:text-neutral-100">{breadcrumb.project}</span>
        <span className="ml-auto text-xs text-neutral-400">{records.length} task{records.length === 1 ? "" : "s"} · {table.myRole}</span>
      </div>

      <ViewTabs
        views={table.views}
        activeId={activeViewId}
        onSelect={setActiveViewId}
        onCreate={handleCreateView}
        onRename={handleRenameView}
        onDelete={handleDeleteView}
        onDuplicate={handleDuplicateView}
        onReorder={handleReorderViews}
      />

      {activeView?.type !== "form" && (
        <ViewToolbar
          fields={fields}
          config={config}
          members={members}
          search={search}
          onSearchChange={setSearch}
          onConfigChange={updateConfig}
          selectedCount={selectedIds.size}
          onBulkDelete={handleBulkDelete}
          onClearSelection={() => setSelectedIds(new Set())}
          onExportClick={() => setExportOpen(true)}
          onSaveAsView={handleSaveAsView}
          viewType={activeView?.type ?? "grid"}
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
          onConfigChange={(patch) => updateConfig({ gallery: { ...(config.gallery ?? {}), ...patch } })}
          onOpenRecord={setOpenRecordId}
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
        />
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
          onAddRecord={handleAddRecord}
          onOpenRecord={setOpenRecordId}
          onAddField={canEdit ? handleAddField : () => toast.info("Only editors can add fields")}
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
          onClose={() => setOpenRecordId(null)}
          onChange={(fieldId, value) => handleCellChange(openRecord.id, fieldId, value)}
          onDelete={() => {
            if (confirm("Delete this record?")) handleDeleteRecord(openRecord.id);
          }}
        />
      )}

      <FieldEditorDialog
        open={fieldDialog.open}
        onOpenChange={(v) => setFieldDialog((d) => ({ ...d, open: v }))}
        field={fieldDialog.field ? { name: fieldDialog.field.name, type: fieldDialog.field.type, description: fieldDialog.field.description, config: parseFieldConfig(fieldDialog.field.config) } : null}
        onSave={handleFieldSave}
      />

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

"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Share2, Workflow as WorkflowIcon, Bell, ChevronRight } from "lucide-react";
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
import { parseFieldConfig, getFieldType, carryOverConfig, IMPORTANCE_OPTIONS, URGENCY_OPTIONS } from "@/lib/field-types";
import { EisenhowerView } from "@/components/eisenhower/eisenhower-view";
import type { OkrOptions } from "@/components/grid/cell";
import type { FieldRow, RecordRow, ViewRow } from "@/types";

interface TableDetail {
  id: string;
  name: string;
  fields: FieldRow[];
  views: ViewRow[];
  members: Member[];
  myRole: string;
  base: { id: string; name: string; workspaceId: string; workspace: { slug: string; name: string } };
}

export function TableWorkspace({
  tableId,
  baseId,
  breadcrumb,
}: {
  tableId: string;
  baseId: string;
  workspaceSlug: string;
  breadcrumb: { workspace: string; base: string; table: string };
}) {
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const currentUserId = (session?.user as { id?: string } | undefined)?.id;
  const [table, setTable] = useState<TableDetail | null>(null);
  const [otherTables, setOtherTables] = useState<{ id: string; name: string }[]>([]);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [activeViewId, setActiveViewId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [openRecordId, setOpenRecordId] = useState<string | null>(searchParams.get("record"));
  const [fieldDialog, setFieldDialog] = useState<{ open: boolean; field: FieldRow | null; insertAfterOrder?: number }>({ open: false, field: null });
  const [exportOpen, setExportOpen] = useState(false);
  const [linkTargets, setLinkTargets] = useState<Record<string, LinkTarget>>({});
  const [okrOptions, setOkrOptions] = useState<OkrOptions>({ objectives: [], keyResults: [] });
  const [loading, setLoading] = useState(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [detail, recs] = await Promise.all([
        api.get<TableDetail>(`/api/tables/${tableId}`),
        api.get<RecordRow[]>(`/api/tables/${tableId}/records`),
      ]);
      setTable(detail);
      setRecords(recs);
      const requestedViewId = searchParams.get("view");
      const requestedViewValid = requestedViewId && detail.views.some((v) => v.id === requestedViewId);
      setActiveViewId((prev) => (requestedViewValid ? requestedViewId! : prev || detail.views.find((v) => v.isDefault)?.id || detail.views[0]?.id || ""));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load table");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-fetch the whole table when tableId changes; the view-param sync effect below reacts to searchParams on its own
  }, [tableId]);

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

  useEffect(() => {
    api
      .get<{ id: string; name: string }[]>(`/api/bases/${baseId}/tables`)
      .then((tables) => setOtherTables(tables.filter((t) => t.id !== tableId)))
      .catch(() => {});
  }, [baseId, tableId]);

  // Resolve labels for Link-to-Record fields by fetching the target table once per table.
  useEffect(() => {
    if (!table) return;
    const linkFields = table.fields.filter((f) => f.type === "link" && parseFieldConfig(f.config).linkTableId);
    const targetTableIds = [...new Set(linkFields.map((f) => parseFieldConfig(f.config).linkTableId!))];
    targetTableIds.forEach(async (targetTableId) => {
      try {
        const [detail, recs] = await Promise.all([
          api.get<TableDetail>(`/api/tables/${targetTableId}`),
          api.get<RecordRow[]>(`/api/tables/${targetTableId}/records`),
        ]);
        const primary = detail.fields.find((f) => f.isPrimary);
        const target: LinkTarget = {
          records: recs.map((r) => ({ id: r.id, label: primary ? String((r.data as Record<string, unknown>)[primary.id] ?? "") : r.id })),
        };
        setLinkTargets((prev) => {
          const next = { ...prev };
          for (const f of linkFields) if (parseFieldConfig(f.config).linkTableId === targetTableId) next[f.id] = target;
          return next;
        });
      } catch {
        // target table may have been deleted; ignore
      }
    });
  }, [table]);

  // Live Objective/Key Result options for `okr_objective`/`okr_key_result` cell pickers.
  useEffect(() => {
    if (!table) return;
    const hasOkrFields = table.fields.some((f) => f.type === "okr_objective" || f.type === "okr_key_result");
    if (!hasOkrFields) return;
    api
      .get<OkrOptions>(`/api/workspaces/${table.base.workspaceId}/okr-options`)
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
      await api.patch(`/api/records/${recordId}`, { data: patch });
    } catch {
      toast.error("Failed to save change");
      load();
    }
  }

  async function handleAddRecord(initialData?: Record<string, unknown>) {
    try {
      const record = await api.post<RecordRow>(`/api/tables/${tableId}/records`, { data: initialData ?? {} });
      setRecords((prev) => [...prev, record]);
    } catch {
      toast.error("Failed to add record");
    }
  }

  async function handleDeleteRecord(id: string) {
    setRecords((prev) => prev.filter((r) => r.id !== id));
    setOpenRecordId(null);
    try {
      await api.delete(`/api/records/${id}`);
    } catch {
      toast.error("Failed to delete record");
      load();
    }
  }

  async function handleBulkDelete() {
    const ids = [...selectedIds];
    setRecords((prev) => prev.filter((r) => !selectedIds.has(r.id)));
    setSelectedIds(new Set());
    try {
      await api.post(`/api/tables/${tableId}/records/bulk-delete`, { ids });
    } catch {
      toast.error("Failed to delete records");
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

  async function handleAddField(afterFieldId: string | undefined, type: string) {
    const afterField = fields.find((f) => f.id === afterFieldId) ?? fields[fields.length - 1];
    const typeDef = getFieldType(type);
    const defaultConfig = ["single_select", "multi_select", "status"].includes(type)
      ? { options: [{ id: nanoid(6), label: "Option 1", color: "#3b82f6" }] }
      : type === "importance"
      ? { options: IMPORTANCE_OPTIONS }
      : type === "urgency"
      ? { options: URGENCY_OPTIONS }
      : {};
    try {
      const field = await api.post<FieldRow>(`/api/tables/${tableId}/fields`, {
        name: typeDef.label,
        type,
        insertAfterOrder: afterField?.order,
        config: defaultConfig,
      });
      await load();
      setFieldDialog({ open: true, field });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add field");
    }
  }

  async function handleFieldAction(fieldId: string, action: string) {
    const field = fields.find((f) => f.id === fieldId);
    if (!field) return;
    const idx = fields.findIndex((f) => f.id === fieldId);

    if (action.startsWith("type:")) {
      const newType = action.slice("type:".length);
      if (newType === field.type) return;
      try {
        await api.patch(`/api/fields/${fieldId}`, { type: newType, config: carryOverConfig(field.type, newType, parseFieldConfig(field.config)) });
        toast.success(`Field type changed to ${getFieldType(newType).label}`);
        load();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to change field type");
      }
      return;
    }

    switch (action) {
      case "edit":
      case "description":
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
        try {
          await api.post(`/api/tables/${tableId}/fields`, {
            name: `${field.name} copy`,
            type: field.type,
            config: parseFieldConfig(field.config),
            insertAfterOrder: field.order,
          });
          load();
        } catch {
          toast.error("Failed to duplicate field");
        }
        return;
      case "hide":
        updateConfig({ hiddenFieldIds: [...(config.hiddenFieldIds ?? []), fieldId] });
        return;
      case "insert_left":
      case "insert_right":
        try {
          await api.post(`/api/tables/${tableId}/fields`, {
            name: "New Field",
            type: "text",
            insertAfterOrder: action === "insert_left" ? (fields[idx - 1]?.order ?? field.order - 1) : field.order,
          });
          load();
        } catch {
          toast.error("Failed to insert field");
        }
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
        if (!confirm(`Delete field "${field.name}"? This cannot be undone.`)) return;
        try {
          await api.delete(`/api/fields/${fieldId}`);
          load();
        } catch {
          toast.error("Failed to delete field");
        }
        return;
    }
  }

  async function handleFieldSave(draft: FieldDraft) {
    const target = fieldDialog.field;
    try {
      if (target) {
        await api.patch(`/api/fields/${target.id}`, draft);
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
      await Promise.all(orderedIds.map((id, i) => api.patch(`/api/records/${id}`, { order: i })));
    } catch {
      toast.error("Failed to reorder");
    }
  }

  async function handleCreateView(name: string, type: string) {
    try {
      const view = await api.post<ViewRow>(`/api/tables/${tableId}/views`, { name, type });
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
      const view = await api.post<ViewRow>(`/api/tables/${tableId}/views`, {
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
      const view = await api.post<ViewRow>(`/api/tables/${tableId}/views`, {
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
      <div className="flex-1 flex items-center justify-center text-neutral-400 text-sm">Loading table…</div>
    );
  }
  if (!table) return null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-1.5 h-12 px-4 border-b border-neutral-200 dark:border-neutral-800 shrink-0 text-sm">
        <span className="text-neutral-400">{breadcrumb.workspace}</span>
        <ChevronRight size={13} className="text-neutral-300" />
        <span className="text-neutral-400">{breadcrumb.base}</span>
        <ChevronRight size={13} className="text-neutral-300" />
        <span className="font-medium text-neutral-800 dark:text-neutral-100">{breadcrumb.table}</span>
        <div className="ml-auto flex items-center gap-1">
          <TopBarIconButton icon={<Share2 size={14} />} label="Share" />
          <TopBarIconButton icon={<WorkflowIcon size={14} />} label="Automations" />
          <TopBarIconButton icon={<Bell size={14} />} label="Notifications" />
        </div>
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
          onAddField={handleAddField}
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
        tableId={tableId}
        tableName={table.name}
        otherTables={otherTables}
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

function TopBarIconButton({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={() => toast.info(`${label} is planned for a later phase`)}
      title={label}
      className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800"
    >
      {icon}
    </button>
  );
}

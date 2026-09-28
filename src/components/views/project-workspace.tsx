"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { api } from "@/lib/api-client";
import { onViewsChanged } from "@/lib/view-events";
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
import { parseFieldConfig, getFieldType, CUSTOM_FIELD_TYPE_IDS } from "@/lib/field-types";
import { EisenhowerView } from "@/components/eisenhower/eisenhower-view";
import { ReportView } from "@/components/report/report-view";
import { ProjectHeader } from "@/components/projects/project-tabs";
import { useT } from "@/components/i18n-provider";
import type { MessageKey } from "@/lib/i18n/core";
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
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api.patch(`/api/views/${activeView.id}`, { config: next }).catch(() => toast.error(t("common.failed")));
    }, 400);
  }

  function updateConfig(patch: Partial<ViewConfig>) {
    persistViewConfig({ ...config, ...patch });
  }

  const fields = useMemo(() => table?.fields ?? [], [table]);
  const canEdit = (ROLE_RANK[table?.myRole ?? ""] ?? -1) >= ROLE_RANK.editor;

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
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
      load();
    }
  }

  async function handleAddRecord(initialData?: Record<string, unknown>) {
    try {
      const record = await api.post<RecordRow>(`/api/projects/${projectId}/tasks`, { data: initialData ?? {} });
      setRecords((prev) => [...prev, record]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
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

  async function handleAddField(_afterFieldId: string | undefined, type: string) {
    const typeDef = getFieldType(type);
    const defaultConfig = ["single_select", "multi_select"].includes(type) ? { options: [{ id: crypto.randomUUID(), label: `${t("fe.newOption")} 1`, color: "#3b82f6" }] } : {};
    try {
      const created = await api.post<{ id: string }>(`/api/projects/${projectId}/custom-fields`, { name: CUSTOM_FIELD_TYPE_IDS.includes(type) ? t(`ft.${type}` as MessageKey) : typeDef.label, type, config: defaultConfig });
      const detail = await api.get<ProjectDetail>(`/api/projects/${projectId}`);
      setTable(detail);
      setFieldDialog({ open: true, field: detail.fields.find((f) => f.id === created.id) ?? null });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  async function createCustomField(body: { name: string; type: string; config?: object }) {
    try {
      await api.post(`/api/projects/${projectId}/custom-fields`, body);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  async function handleFieldAction(fieldId: string, action: string) {
    const field = fields.find((f) => f.id === fieldId);
    if (!field) return;
    const idx = fields.findIndex((f) => f.id === fieldId);

    if (action.startsWith("type:")) {
      toast.info(t("pw2.typeLocked"))
      return;
    }

    switch (action) {
      case "edit":
      case "description":
        if (field.system) {
          toast.info(field.id === "sys_status" ? t("pw2.statusHint") : field.id === "sys_category" ? t("pw2.categoryHint") : t("pw2.builtinEdit"));
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
        toast.info(t("pw2.ruleAdded"));
        return;
      }
      case "duplicate":
        if (field.system) {
          toast.info(t("pw2.builtinDup"));
          return;
        }
        await createCustomField({ name: `${field.name} copy`, type: field.type, config: { ...parseFieldConfig(field.config), options: parseFieldConfig(field.config).options?.map((o) => ({ label: o.label, color: o.color })) } });
        return;
      case "hide":
        updateConfig({ hiddenFieldIds: [...(config.hiddenFieldIds ?? []), fieldId] });
        return;
      case "insert_left":
      case "insert_right":
        await createCustomField({ name: t("fe.new"), type: "text" });
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
          toast.info(t("pw2.builtinDel"));
          return;
        }
        if (!confirm(t("pw2.deleteField", { name: field.name }))) return;
        try {
          await api.delete(`/api/custom-fields/${fieldId}`);
          load();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : t("common.failed"));
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
      toast.error(e instanceof Error ? e.message : t("common.failed"));
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
      toast.error(t("common.failed"));
    }
  }

  async function handleCreateView(name: string, type: string) {
    try {
      const view = await api.post<ViewRow>(`/api/projects/${projectId}/views`, { name, type });
      setTable((t) => (t ? { ...t, views: [...t.views, view] } : t));
      setActiveViewId(view.id);
      syncSidebar();
    } catch {
      toast.error(t("common.failed"));
    }
  }
  async function handleRenameView(id: string, name: string) {
    setTable((t) => (t ? { ...t, views: t.views.map((v) => (v.id === id ? { ...v, name } : v)) } : t));
    api.patch(`/api/views/${id}`, { name }).then(syncSidebar).catch(() => {});
  }
  async function handleDeleteView(id: string) {
    try {
      await api.delete(`/api/views/${id}`);
      setTable((t) => (t ? { ...t, views: t.views.filter((v) => v.id !== id) } : t));
      setActiveViewId((prev) => (prev === id ? table?.views.find((v) => v.id !== id)?.id ?? "" : prev));
      syncSidebar();
    } catch {
      toast.error(t("common.failed"));
    }
  }
  async function handleSaveAsView() {
    if (!activeView) return;
    const name = prompt(t("view.namePrompt"), `${activeView.name} (2)`);
    if (!name) return;
    try {
      const view = await api.post<ViewRow>(`/api/projects/${projectId}/views`, {
        name,
        type: activeView.type,
        config: JSON.parse(activeView.config || "{}"),
      });
      setTable((t) => (t ? { ...t, views: [...t.views, view] } : t));
      setActiveViewId(view.id);
      syncSidebar();
      toast.success(`Saved as "${name}"`);
    } catch {
      toast.error(t("common.failed"));
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
      syncSidebar();
    } catch {
      toast.error(t("common.failed"));
    }
  }
  async function handleReorderViews(orderedIds: string[]) {
    const map = new Map(orderedIds.map((id, i) => [id, i]));
    setTable((t) => (t ? { ...t, views: [...t.views].sort((a, b) => (map.get(a.id) ?? 0) - (map.get(b.id) ?? 0)) } : t));
    try {
      await Promise.all(orderedIds.map((id, i) => api.patch(`/api/views/${id}`, { order: i })));
      syncSidebar();
    } catch {
      toast.error(t("common.failed"));
    }
  }
  async function handleTogglePublic(isPublic: boolean) {
    if (!activeView) return;
    setTable((t) => (t ? { ...t, views: t.views.map((v) => (v.id === activeView.id ? { ...v, isPublic } : v)) } : t));
    try {
      await api.patch(`/api/views/${activeView.id}`, { isPublic });
    } catch {
      toast.error(t("common.failed"));
    }
  }

  const openRecord = records.find((r) => r.id === openRecordId);

  if (loading && !table) {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-400 text-sm">{t("common.loading")}</div>
    );
  }
  if (!table) return null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <ProjectHeader
        workspaceSlug={table.workspace.slug}
        workspaceName={breadcrumb.workspace}
        projectId={projectId}
        projectName={breadcrumb.project}
        right={
          <>
            {t("project.tasksCount", { count: records.length })} · {t(`role.${table.myRole}` as MessageKey)}
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
      ) : activeView?.type === "report" ? (
        <ReportView fields={fields} records={sorted} members={members} config={config.report ?? {}} canEdit={canEdit} onConfigChange={(next) => updateConfig({ report: next })} />
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
          onAddField={canEdit ? handleAddField : () => toast.info(t("pw2.editorsOnly"))}
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
          onClose={() => setOpenRecordId(null)}
          onChange={(fieldId, value) => handleCellChange(openRecord.id, fieldId, value)}
          onDelete={() => {
            if (confirm(t("record.deleteConfirm"))) handleDeleteRecord(openRecord.id);
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

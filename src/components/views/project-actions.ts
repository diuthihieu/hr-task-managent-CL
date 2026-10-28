"use client";
// What the project screen does when a column or a view changes. Moved out of
// project-workspace.tsx as-is: each factory gets the screen's current state and
// setters, and is called on every render like the inline functions were.
import type { Dispatch, SetStateAction } from "react";
import { nanoid } from "nanoid";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import type { FieldDraft } from "@/components/fields/field-editor-dialog";
import type { ViewConfig, FilterCondition } from "@/lib/query-engine";
import { parseFieldConfig, getFieldType, CUSTOM_FIELD_TYPE_IDS } from "@/lib/field-types";
import type { MessageKey, TFunction } from "@/lib/i18n/core";
import type { FieldRow, ViewRow } from "@/types";
import type { Member } from "@/components/grid/cell";

export interface ProjectDetail {
  id: string;
  name: string;
  fields: FieldRow[];
  views: ViewRow[];
  members: Member[];
  myRole: string;
  myPermissions?: string[];
  workspace: { id: string; slug: string; name: string };
}

export type FieldDialogState = { open: boolean; field: FieldRow | null; insertAfterOrder?: number };

export function fieldActions({
  projectId,
  t,
  fields,
  canFields,
  config,
  updateConfig,
  load,
  setTable,
  fieldDialog,
  setFieldDialog,
}: {
  projectId: string;
  t: TFunction;
  fields: FieldRow[];
  canFields: boolean;
  config: ViewConfig;
  updateConfig: (patch: Partial<ViewConfig>) => void;
  load: () => unknown;
  setTable: Dispatch<SetStateAction<ProjectDetail | null>>;
  fieldDialog: FieldDialogState;
  setFieldDialog: Dispatch<SetStateAction<FieldDialogState>>;
}) {
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
    // Changing the columns themselves needs "Add / edit columns"; view-only actions (hide, sort, filter…) don't.
    if (!canFields && ["edit", "description", "duplicate", "insert_left", "insert_right", "delete"].includes(action) && !field.system) return void toast.info(t("pp.noFields"));
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

  return { handleAddField, handleFieldAction, handleFieldSave, handleReorderFields, handleResizeColumn };
}

export function viewActions({
  projectId,
  t,
  table,
  setTable,
  activeView,
  setActiveViewId,
  syncSidebar,
}: {
  projectId: string;
  t: TFunction;
  table: ProjectDetail | null;
  setTable: Dispatch<SetStateAction<ProjectDetail | null>>;
  activeView: ViewRow | undefined;
  setActiveViewId: Dispatch<SetStateAction<string>>;
  syncSidebar: () => void;
}) {
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

  return { handleCreateView, handleRenameView, handleDeleteView, handleSaveAsView, handleDuplicateView, handleReorderViews, handleTogglePublic };
}

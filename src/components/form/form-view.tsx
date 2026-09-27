"use client";
import { useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, ChevronDown, ChevronRight, Link2, Copy, Check } from "lucide-react";
import { Switch, Select } from "@/components/ui/misc";
import { Input, Textarea } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { FormRenderer } from "./form-renderer";
import { FormFieldInput } from "./form-field-input";
import { getOrderedFormFields, isFieldFormable } from "@/lib/form-utils";
import { operatorsForType } from "@/components/filters/operator-options";
import type { FormConfig, FormFieldConfig, FilterOperator } from "@/lib/query-engine";
import type { FieldRow, ViewRow } from "@/types";
import type { Member } from "@/components/grid/cell";
import { cn } from "@/lib/utils";
import { useT } from "@/components/i18n-provider";

export function FormView({
  view,
  tableName,
  fields,
  members,
  config,
  onConfigChange,
  onTogglePublic,
  publicUrl,
  onSubmitRecord,
}: {
  view: ViewRow;
  tableName: string;
  fields: FieldRow[];
  members: Member[];
  config: FormConfig;
  onConfigChange: (patch: Partial<FormConfig>) => void;
  onTogglePublic: (isPublic: boolean) => void;
  publicUrl: string;
  onSubmitRecord: (data: Record<string, unknown>) => Promise<void>;
}) {
  const { t } = useT();
  const orderedFields = getOrderedFormFields(fields, config);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const [copied, setCopied] = useState(false);

  function patchField(fieldId: string, patch: Partial<FormFieldConfig>) {
    const current = orderedFields.map(({ field, formField }) => (field.id === fieldId ? { ...formField, ...patch } : formField));
    onConfigChange({ fields: current });
  }

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = orderedFields.map(({ field }) => field.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    const reordered = arrayMove(ids, oldIndex, newIndex);
    const byId = new Map(orderedFields.map(({ field, formField }) => [field.id, formField]));
    onConfigChange({ fields: reordered.map((id) => byId.get(id)!) });
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t("form.copyFailed"));
    }
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      <div className="w-[380px] shrink-0 border-r border-neutral-200 dark:border-neutral-800 flex flex-col overflow-hidden">
        <div className="px-3 py-2.5 border-b border-neutral-200 dark:border-neutral-800 space-y-2 shrink-0">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-neutral-700 dark:text-neutral-200">{t("form.publicLink")}</span>
            <Switch checked={view.isPublic ?? false} onCheckedChange={onTogglePublic} />
          </div>
          {view.isPublic && (
            <div className="flex items-center gap-1.5">
              <Link2 size={13} className="text-neutral-400 shrink-0" />
              <input readOnly value={publicUrl} className="flex-1 h-7 text-xs rounded-md border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 px-2 truncate" />
              <button onClick={copyLink} className="text-neutral-400 hover:text-indigo-600 shrink-0">
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto thin-scroll p-2">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={orderedFields.map(({ field }) => field.id)} strategy={verticalListSortingStrategy}>
              {orderedFields.map(({ field, formField }) => (
                <FieldRowEditor key={field.id} field={field} formField={formField} allFields={fields} config={config} onPatch={(p) => patchField(field.id, p)} onConfigChange={onConfigChange} />
              ))}
            </SortableContext>
          </DndContext>
          {fields.filter(isFieldFormable).length === 0 && <p className="text-xs text-neutral-400 p-2">{t("form.noFields")}</p>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto thin-scroll p-8 bg-neutral-50 dark:bg-neutral-950">
        <FormRenderer tableName={tableName} fields={fields} members={members} config={config} onSubmit={onSubmitRecord} />
      </div>
    </div>
  );
}

function FieldRowEditor({
  field,
  formField,
  allFields,
  config,
  onPatch,
  onConfigChange,
}: {
  field: FieldRow;
  formField: FormFieldConfig;
  allFields: FieldRow[];
  config: FormConfig;
  onPatch: (patch: Partial<FormFieldConfig>) => void;
  onConfigChange: (patch: Partial<FormConfig>) => void;
}) {
  const { t } = useT();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id });
  const [expanded, setExpanded] = useState(false);
  const rule = config.conditionalRules?.find((r) => r.targetFieldId === field.id);
  const otherFields = allFields.filter((f) => f.id !== field.id && isFieldFormable(f));

  function setRule(patch: Partial<{ whenFieldId: string; operator: FilterOperator; value: unknown }>) {
    const next = { id: rule?.id ?? `${field.id}-rule`, targetFieldId: field.id, whenFieldId: rule?.whenFieldId ?? otherFields[0]?.id ?? "", operator: rule?.operator ?? "is", value: rule?.value, ...patch };
    const rules = (config.conditionalRules ?? []).filter((r) => r.targetFieldId !== field.id);
    onConfigChange({ conditionalRules: [...rules, next] });
  }
  function removeRule() {
    onConfigChange({ conditionalRules: (config.conditionalRules ?? []).filter((r) => r.targetFieldId !== field.id) });
  }

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn("rounded-md border border-neutral-200 dark:border-neutral-800 mb-1.5 bg-white dark:bg-neutral-900", isDragging && "opacity-50 z-10 relative")}>
      <div className="flex items-center gap-1.5 px-2 h-9">
        <span {...attributes} {...listeners} className="text-neutral-300 cursor-grab shrink-0">
          <GripVertical size={13} />
        </span>
        <button onClick={() => setExpanded((e) => !e)} className="text-neutral-400 shrink-0">
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <span className="text-sm text-neutral-800 dark:text-neutral-100 truncate flex-1">{field.name}</span>
        <label className="flex items-center gap-1 text-[11px] text-neutral-500 shrink-0" title={t("form.required")}>
          {t("form.req")}
          <Switch checked={formField.required} onCheckedChange={(v) => onPatch({ required: v })} />
        </label>
        <Switch checked={formField.visible} onCheckedChange={(v) => onPatch({ visible: v })} />
      </div>
      {expanded && (
        <div className="px-2 pb-2.5 space-y-2 border-t border-neutral-100 dark:border-neutral-800 pt-2">
          <div>
            <label className="text-[11px] font-medium text-neutral-500 mb-1 block">{t("form.help")}</label>
            <Textarea rows={2} value={formField.description ?? ""} onChange={(e) => onPatch({ description: e.target.value })} placeholder={t("form.helpPh")} />
          </div>
          <div>
            <label className="text-[11px] font-medium text-neutral-500 mb-1 block">{t("form.default")}</label>
            <FormFieldInput field={field} value={formField.defaultValue} members={[]} onChange={(v) => onPatch({ defaultValue: v })} />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-medium text-neutral-500">{t("form.showIf")}</label>
              {rule && (
                <button onClick={removeRule} className="text-[11px] text-neutral-400 hover:text-red-600">
                  Remove
                </button>
              )}
            </div>
            {otherFields.length === 0 ? (
              <p className="text-[11px] text-neutral-400">{t("form.noOther")}</p>
            ) : (
              <div className="flex items-center gap-1.5">
                <Select className="flex-1" value={rule?.whenFieldId ?? ""} onValueChange={(v) => setRule({ whenFieldId: v })} options={otherFields.map((f) => ({ value: f.id, label: f.name }))} placeholder={t("form.chooseField")} />
                <Select
                  className="w-24 shrink-0"
                  value={rule?.operator ?? "is"}
                  onValueChange={(v) => setRule({ operator: v as FilterOperator })}
                  options={rule?.whenFieldId ? operatorsForType(allFields.find((f) => f.id === rule.whenFieldId)?.type ?? "text", t) : []}
                />
                {rule && !["is_empty", "is_not_empty"].includes(rule.operator) && (
                  <Input className="flex-1" value={(rule.value as string) ?? ""} onChange={(e) => setRule({ value: e.target.value })} placeholder="value" />
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

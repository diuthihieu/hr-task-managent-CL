"use client";
import { useState } from "react";
import { Plus, X, GripVertical } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import type { MessageKey } from "@/lib/i18n/core";
import { FIELD_TYPES, CUSTOM_FIELD_TYPE_IDS, getFieldType, type FieldCategory, type FieldConfig, type SelectOption } from "@/lib/field-types";
import type { FieldRow } from "@/types";
import { useT } from "@/components/i18n-provider";

const CATEGORIES: FieldCategory[] = ["basic", "selection", "people", "contact", "files", "calculated", "relational", "system", "action"];
const OPTION_COLORS = ["#94a3b8", "#3b82f6", "#22c55e", "#eab308", "#f97316", "#ef4444", "#8b5cf6", "#ec4899"];

export interface FieldDraft {
  name: string;
  type: string;
  description: string;
  config: FieldConfig;
}

export function FieldEditorDialog({
  open,
  onOpenChange,
  field,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  field: (Pick<FieldRow, "name" | "type" | "description"> & { config: FieldConfig }) | null;
  onSave: (draft: FieldDraft) => void;
}) {
  const { t } = useT();
  function makeDraft(): FieldDraft {
    return field
      ? { name: field.name, type: field.type, description: field.description ?? "", config: field.config }
      : { name: "", type: "text", description: "", config: {} };
  }

  const [draft, setDraft] = useState<FieldDraft>(makeDraft);
  const [wasOpen, setWasOpen] = useState(false);

  // Re-seed the draft from `field` whenever the dialog transitions from closed to open.
  if (open && !wasOpen) {
    setWasOpen(true);
    setDraft(makeDraft());
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }

  function patchConfig(patch: Partial<FieldConfig>) {
    setDraft((d) => ({ ...d, config: { ...d.config, ...patch } }));
  }

  const options = draft.config.options ?? [];
  function updateOption(id: string, patch: Partial<SelectOption>) {
    patchConfig({ options: options.map((o) => (o.id === id ? { ...o, ...patch } : o)) });
  }
  function addOption() {
    patchConfig({ options: [...options, { id: crypto.randomUUID(), label: t("fe.newOption"), color: OPTION_COLORS[options.length % OPTION_COLORS.length] }] });
  }
  function removeOption(id: string) {
    patchConfig({ options: options.filter((o) => o.id !== id) });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle>{field ? t("fe.edit") : t("fe.new")}</DialogTitle>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("fe.name")}</label>
            <Input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} autoFocus />
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("fe.type")}</label>
            {field ? (
              <div className="text-sm text-neutral-700 dark:text-neutral-300 px-2.5 py-1.5 rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950">
                {CUSTOM_FIELD_TYPE_IDS.includes(draft.type) ? t(`ft.${draft.type}` as MessageKey) : getFieldType(draft.type).label}
                <span className="ml-2 text-[11px] text-neutral-400">the type is fixed once a field is created</span>
              </div>
            ) : (
              <Select
                value={draft.type}
                onValueChange={(v) => setDraft((d) => ({ ...d, type: v, config: {} }))}
                options={CATEGORIES.flatMap((cat) =>
                  FIELD_TYPES.filter((f) => f.category === cat && CUSTOM_FIELD_TYPE_IDS.includes(f.type)).map((f) => ({ value: f.type, label: `${t(`fc.${cat}` as MessageKey)} ${t(`ft.${f.type}` as MessageKey)}` }))
                )}
                className="w-full"
              />
            )}
          </div>

          {["single_select", "multi_select"].includes(draft.type) && (
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("fe.options")}</label>
              <div className="space-y-1.5 max-h-48 overflow-y-auto thin-scroll">
                {options.map((o) => (
                  <div key={o.id} className="flex items-center gap-1.5">
                    <GripVertical size={12} className="text-neutral-300 shrink-0" />
                    <div className="flex gap-1 shrink-0">
                      {OPTION_COLORS.map((c) => (
                        <button
                          key={c}
                          onClick={() => updateOption(o.id, { color: c })}
                          className="h-4 w-4 rounded-full border"
                          style={{ backgroundColor: c, borderColor: o.color === c ? "#000" : "transparent" }}
                        />
                      ))}
                    </div>
                    <Input value={o.label} onChange={(e) => updateOption(o.id, { label: e.target.value })} className="flex-1 h-7" />
                    <button onClick={() => removeOption(o.id)} className="text-neutral-400 hover:text-red-600 shrink-0">
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
              <button onClick={addOption} className="flex items-center gap-1 text-xs text-indigo-600 hover:underline mt-2">
                <Plus size={12} /> {t("fe.addOption")}
              </button>
            </div>
          )}

          {draft.type === "formula" && (
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("fe.formula")}</label>
              <Textarea
                rows={3}
                value={draft.config.expression ?? ""}
                onChange={(e) => patchConfig({ expression: e.target.value })}
                placeholder={'IF({Progress} >= 100, "Completed", "In Progress")'}
              />
              <p className="text-[11px] text-neutral-400 mt-1">{t("fe.formulaHint")}</p>
            </div>
          )}

          {draft.type === "currency" && (
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("fe.currency")}</label>
              <Input value={draft.config.currencySymbol ?? "$"} onChange={(e) => patchConfig({ currencySymbol: e.target.value })} className="w-20" />
            </div>
          )}

          {draft.type === "rating" && (
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("fe.maxRating")}</label>
              <Input type="number" min={1} max={10} value={draft.config.maxRating ?? 5} onChange={(e) => patchConfig({ maxRating: Number(e.target.value) })} className="w-20" />
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("fe.description")}</label>
            <Textarea rows={2} value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button onClick={() => onSave(draft)} disabled={!draft.name.trim()}>{t("common.save")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

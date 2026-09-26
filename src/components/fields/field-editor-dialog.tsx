"use client";
import { useState } from "react";
import { Plus, X, GripVertical } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { FIELD_TYPES, FIELD_CATEGORY_LABELS, carryOverConfig, type FieldCategory, type FieldConfig, type SelectOption } from "@/lib/field-types";
import { FIELD_ROLE_SPECS, rolesForType, type FieldRole } from "@/lib/field-roles";
import { nanoid } from "nanoid";
import type { FieldRow } from "@/types";

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
  tableId,
  tableName,
  otherTables,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  field: Pick<FieldRow, "name" | "type" | "description"> & { config: FieldConfig } | null;
  tableId: string;
  tableName: string;
  otherTables: { id: string; name: string }[];
  onSave: (draft: FieldDraft) => void;
}) {
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
    patchConfig({ options: [...options, { id: nanoid(6), label: "New option", color: OPTION_COLORS[options.length % OPTION_COLORS.length] }] });
  }
  function removeOption(id: string) {
    patchConfig({ options: options.filter((o) => o.id !== id) });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle>{field ? "Edit field" : "New field"}</DialogTitle>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-neutral-500 mb-1 block">Field name</label>
            <Input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} autoFocus />
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-500 mb-1 block">Type</label>
            <Select
              value={draft.type}
              onValueChange={(v) =>
                setDraft((d) => {
                  const config = carryOverConfig(d.type, v, d.config);
                  // Keep a pinned role only if the new type can still play it.
                  if (d.config.role && rolesForType(v).includes(d.config.role as FieldRole)) config.role = d.config.role;
                  return { ...d, type: v, config };
                })
              }
              options={CATEGORIES.flatMap((cat) => [
                ...FIELD_TYPES.filter((f) => f.category === cat && !f.comingSoon).map((f) => ({ value: f.type, label: `${FIELD_CATEGORY_LABELS[cat]} · ${f.label}` })),
              ])}
              className="w-full"
            />
            {field && field.type !== draft.type && (
              <p className="text-[11px] text-amber-600 dark:text-amber-500 mt-1">
                Existing values will be converted where possible (e.g. number ↔ text, single ↔ multi select); anything that
                can&apos;t be safely converted is kept as-is, not deleted.
              </p>
            )}
          </div>

          {rolesForType(draft.type).length > 0 && (
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">Role</label>
              <Select
                className="w-full"
                value={draft.config.role ?? "auto"}
                onValueChange={(v) => patchConfig({ role: v === "auto" ? undefined : v })}
                options={[
                  { value: "auto", label: "Auto-detect from name" },
                  ...rolesForType(draft.type).map((r) => ({ value: r, label: FIELD_ROLE_SPECS[r].label })),
                ]}
              />
              <p className="text-[11px] text-neutral-400 mt-1">
                Tells My Work, OKR progress and Put All Things On what this field means, whatever its name. Auto-detect
                understands English and Vietnamese names (e.g. &quot;Trạng thái&quot;, &quot;Hạn chót&quot;).
              </p>
            </div>
          )}

          {["single_select", "multi_select", "status"].includes(draft.type) && (
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">Options</label>
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
                <Plus size={12} /> Add option
              </button>
            </div>
          )}

          {draft.type === "formula" && (
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">Formula</label>
              <Textarea
                rows={3}
                value={draft.config.expression ?? ""}
                onChange={(e) => patchConfig({ expression: e.target.value })}
                placeholder={'IF({Progress} >= 100, "Completed", "In Progress")'}
              />
              <p className="text-[11px] text-neutral-400 mt-1">Reference fields with {"{Field Name}"}. Supports IF, AND, OR, NOT, CONCAT, UPPER, LOWER, LEN, TODAY, DATE_DIFF, SUM, AVG, MIN, MAX and arithmetic.</p>
            </div>
          )}

          {draft.type === "link" && (
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">Link to table</label>
              <Select
                className="w-full"
                value={draft.config.linkTableId ?? ""}
                onValueChange={(v) => patchConfig({ linkTableId: v })}
                options={[
                  { value: tableId, label: `${tableName} (this table)` },
                  ...otherTables.map((t) => ({ value: t.id, label: t.name })),
                ]}
                placeholder="Choose a table"
              />
              <p className="text-[11px] text-neutral-400 mt-1">
                Link to this table to model dependencies between records (e.g. a &quot;Depends On&quot; field for Gantt).
              </p>
            </div>
          )}

          {draft.type === "attachment" && (
            <p className="text-[11px] text-neutral-400 -mt-1">Attach files by URL - paste a link and give it a name from the cell.</p>
          )}

          {(draft.type === "importance" || draft.type === "urgency") && (
            <p className="text-[11px] text-neutral-400 -mt-1">
              {draft.type === "importance" ? "Important / Not Important" : "Urgent / Not Urgent"} - a fixed pair used by
              the Eisenhower view to place cards in quadrants.
            </p>
          )}

          {(draft.type === "okr_objective" || draft.type === "okr_key_result") && (
            <p className="text-[11px] text-neutral-400 -mt-1">
              Pick from this workspace&apos;s live {draft.type === "okr_objective" ? "Objectives" : "Key Results"} - manage them from the OKRs section.
            </p>
          )}

          {draft.type === "currency" && (
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">Currency symbol</label>
              <Input value={draft.config.currencySymbol ?? "$"} onChange={(e) => patchConfig({ currencySymbol: e.target.value })} className="w-20" />
            </div>
          )}

          {draft.type === "rating" && (
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">Max rating</label>
              <Input type="number" min={1} max={10} value={draft.config.maxRating ?? 5} onChange={(e) => patchConfig({ maxRating: Number(e.target.value) })} className="w-20" />
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-neutral-500 mb-1 block">Description (optional)</label>
            <Textarea rows={2} value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => onSave(draft)} disabled={!draft.name.trim()}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

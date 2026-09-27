"use client";
import { Plus, X, Paintbrush } from "lucide-react";
import { Select } from "@/components/ui/misc";
import { nanoid } from "nanoid";
import { operatorsForType } from "./operator-options";
import { FilterValueInput } from "./filter-panel";
import type { ConditionalFormatRule, FilterOperator } from "@/lib/query-engine";
import type { FieldRow } from "@/types";
import type { Member } from "@/components/grid/cell";
import { useT } from "@/components/i18n-provider";

const NO_VALUE_OPS: FilterOperator[] = ["is_empty", "is_not_empty", "today", "yesterday", "this_week", "this_month", "is_current_user"];
const COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899", "#64748b"];

export function FormatPanel({
  fields,
  rules,
  members,
  onChange,
}: {
  fields: FieldRow[];
  rules: ConditionalFormatRule[];
  members: Member[];
  onChange: (rules: ConditionalFormatRule[]) => void;
}) {
  const { t } = useT();
  function update(id: string, patch: Partial<ConditionalFormatRule>) {
    onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function remove(id: string) {
    onChange(rules.filter((r) => r.id !== id));
  }
  function add() {
    const field = fields[0];
    if (!field) return;
    onChange([
      ...rules,
      { id: nanoid(8), fieldId: field.id, operator: operatorsForType(field.type)[0]?.value ?? "equals", target: "cell", color: COLORS[0] },
    ]);
  }

  return (
    <div className="w-[440px] p-3">
      <div className="flex items-center gap-2 mb-3 text-xs font-semibold text-neutral-500">
        <Paintbrush size={13} /> {t("fmt.title")}
      </div>
      {rules.length === 0 && <p className="text-xs text-neutral-400 mb-2">{t("fmt.none")}</p>}
      <div className="space-y-2.5 max-h-80 overflow-y-auto thin-scroll">
        {rules.map((rule) => {
          const field = fields.find((f) => f.id === rule.fieldId) ?? fields[0];
          const ops = field ? operatorsForType(field.type, t) : [];
          const needsValue = !NO_VALUE_OPS.includes(rule.operator);
          return (
            <div key={rule.id} className="rounded-md border border-neutral-200 dark:border-neutral-800 p-2 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-neutral-400 w-6 shrink-0">{t("fmt.if")}</span>
                <Select className="flex-1" value={rule.fieldId} onValueChange={(v) => update(rule.id, { fieldId: v })} options={fields.map((f) => ({ value: f.id, label: f.name }))} />
                <Select className="w-32 shrink-0" value={rule.operator} onValueChange={(v) => update(rule.id, { operator: v as FilterOperator })} options={ops} />
                <button onClick={() => remove(rule.id)} className="text-neutral-400 hover:text-red-600 shrink-0">
                  <X size={14} />
                </button>
              </div>
              {needsValue && field && (
                <div className="flex items-center gap-1.5 pl-8">
                  <FilterValueInput field={field} value={rule.value} members={members} onChange={(v) => update(rule.id, { value: v })} />
                </div>
              )}
              <div className="flex items-center gap-2 pl-8">
                <span className="text-xs text-neutral-400">{t("fmt.highlight")}</span>
                <Select
                  className="w-24"
                  value={rule.target}
                  onValueChange={(v) => update(rule.id, { target: v as "cell" | "row" })}
                  options={[{ value: "cell", label: t("fmt.cell") }, { value: "row", label: t("fmt.row") }]}
                />
                <div className="flex gap-1">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => update(rule.id, { color: c })}
                      className="h-5 w-5 rounded-full border-2"
                      style={{ backgroundColor: c, borderColor: rule.color === c ? "#000" : "transparent" }}
                    />
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <button onClick={add} className="flex items-center gap-1 text-xs text-indigo-600 hover:underline mt-3">
        <Plus size={12} /> {t("fmt.add")}
      </button>
    </div>
  );
}

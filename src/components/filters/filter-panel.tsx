"use client";
import { Plus, X, ListFilter } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/misc";
import { nanoid } from "nanoid";
import { operatorsForType } from "./operator-options";
import { parseFieldConfig, SELECT_SINGLE_TYPES } from "@/lib/field-types";
import type { FilterCondition, FilterGroup, FilterOperator } from "@/lib/query-engine";
import type { FieldRow } from "@/types";
import type { Member } from "@/components/grid/cell";
import { useT } from "@/components/i18n-provider";

const NO_VALUE_OPS: FilterOperator[] = ["is_empty", "is_not_empty", "today", "yesterday", "this_week", "this_month", "is_current_user"];

export function FilterPanel({
  fields,
  filter,
  members,
  onChange,
}: {
  fields: FieldRow[];
  filter: FilterGroup;
  members: Member[];
  onChange: (f: FilterGroup) => void;
}) {
  const { t } = useT();
  const conditions = filter.conditions ?? [];

  function updateCondition(id: string, patch: Partial<FilterCondition>) {
    onChange({ ...filter, conditions: conditions.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  }
  function removeCondition(id: string) {
    onChange({ ...filter, conditions: conditions.filter((c) => c.id !== id) });
  }
  function addCondition() {
    const field = fields[0];
    if (!field) return;
    const op = operatorsForType(field.type)[0]?.value ?? "contains";
    onChange({ ...filter, conditions: [...conditions, { id: nanoid(8), fieldId: field.id, operator: op }] });
  }

  return (
    <div className="w-[420px] p-3">
      <div className="flex items-center gap-2 mb-3 text-xs font-semibold text-neutral-500">
        <ListFilter size={13} /> {t("flt.title")}
      </div>
      {conditions.length === 0 && <p className="text-xs text-neutral-400 mb-2">{t("flt.none")}</p>}
      <div className="space-y-2">
        {conditions.map((cond, idx) => {
          const field = fields.find((f) => f.id === cond.fieldId) ?? fields[0];
          const ops = field ? operatorsForType(field.type, t) : [];
          const needsValue = !NO_VALUE_OPS.includes(cond.operator);
          return (
            <div key={cond.id} className="flex items-center gap-1.5">
              <span className="w-10 text-xs text-neutral-400 shrink-0">{idx === 0 ? t("flt.where") : filter.conjunction === "OR" ? t("flt.orLower") : t("flt.andLower")}</span>
              <Select
                className="w-28 shrink-0"
                value={cond.fieldId}
                onValueChange={(v) => {
                  const f = fields.find((ff) => ff.id === v);
                  updateCondition(cond.id, { fieldId: v, operator: f ? operatorsForType(f.type)[0]?.value : cond.operator, value: undefined });
                }}
                options={fields.map((f) => ({ value: f.id, label: f.name }))}
              />
              <Select
                className="w-32 shrink-0"
                value={cond.operator}
                onValueChange={(v) => updateCondition(cond.id, { operator: v as FilterOperator })}
                options={ops}
              />
              {needsValue && field && (
                <FilterValueInput field={field} value={cond.value} members={members} onChange={(v) => updateCondition(cond.id, { value: v })} />
              )}
              <button onClick={() => removeCondition(cond.id)} className="text-neutral-400 hover:text-red-600 shrink-0">
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between mt-3">
        <button onClick={addCondition} className="flex items-center gap-1 text-xs text-indigo-600 hover:underline">
          <Plus size={12} /> {t("flt.add")}
        </button>
        {conditions.length > 1 && (
          <div className="flex items-center gap-1 text-xs">
            <button
              onClick={() => onChange({ ...filter, conjunction: "AND" })}
              className={`px-2 py-0.5 rounded ${filter.conjunction !== "OR" ? "bg-neutral-800 text-white" : "text-neutral-400"}`}
            >
              {t("flt.and")}
            </button>
            <button
              onClick={() => onChange({ ...filter, conjunction: "OR" })}
              className={`px-2 py-0.5 rounded ${filter.conjunction === "OR" ? "bg-neutral-800 text-white" : "text-neutral-400"}`}
            >
              {t("flt.or")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function FilterValueInput({
  field,
  value,
  members,
  onChange,
}: {
  field: FieldRow;
  value: unknown;
  members: Member[];
  onChange: (v: unknown) => void;
}) {
  const config = parseFieldConfig(field.config);
  if ([...SELECT_SINGLE_TYPES, "multi_select"].includes(field.type)) {
    return (
      <Select
        className="flex-1"
        value={(value as string) ?? ""}
        onValueChange={onChange}
        options={(config.options ?? []).map((o) => ({ value: o.id, label: o.label }))}
      />
    );
  }
  if (["person", "people"].includes(field.type)) {
    return (
      <Select className="flex-1" value={(value as string) ?? ""} onValueChange={onChange} options={members.map((m) => ({ value: m.id, label: m.name }))} />
    );
  }
  if (["date", "datetime"].includes(field.type)) {
    return <Input type="date" className="flex-1" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />;
  }
  if (["number", "integer", "percent", "currency", "rating", "progress", "duration"].includes(field.type)) {
    return <Input type="number" className="flex-1" value={(value as number) ?? ""} onChange={(e) => onChange(Number(e.target.value))} />;
  }
  if (field.type === "checkbox") {
    return <Select className="flex-1" value={String(value ?? "true")} onValueChange={(v) => onChange(v === "true")} options={[{ value: "true", label: "Checked" }, { value: "false", label: "Unchecked" }]} />;
  }
  return <Input className="flex-1" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} placeholder="value" />;
}

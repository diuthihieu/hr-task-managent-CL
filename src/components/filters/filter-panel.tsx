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
  const groups = filter.groups ?? [];
  const empty = !(filter.conditions ?? []).length && !groups.length;

  function addGroup() {
    const field = fields[0];
    if (!field) return;
    const op = operatorsForType(field.type)[0]?.value ?? "contains";
    // A new group starts with OR inside when the outside is AND, and the other way round: that's why one adds a group.
    const inner: FilterGroup = { conjunction: filter.conjunction === "OR" ? "AND" : "OR", conditions: [{ id: nanoid(8), fieldId: field.id, operator: op }] };
    onChange({ ...filter, groups: [...groups, inner] });
  }

  return (
    <div className="w-[min(600px,calc(100vw-48px))] p-3" data-testid="filter-panel">
      <div className="flex items-center gap-2 mb-3 text-xs font-semibold text-neutral-500">
        <ListFilter size={13} /> {t("flt.title")}
      </div>
      {empty && <p className="text-xs text-neutral-400 mb-2">{t("flt.none")}</p>}
      <ConditionList fields={fields} members={members} group={filter} onChange={onChange} />
      <GroupBoxes fields={fields} members={members} parent={filter} onChange={onChange} />
      <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
        <div className="flex items-center gap-3">
          <AddConditionButton fields={fields} group={filter} onChange={onChange} />
          <button onClick={addGroup} className="flex items-center gap-1 text-xs text-indigo-600 hover:underline" data-testid="filter-add-group">
            <Plus size={12} /> {t("flt.addGroup")}
          </button>
        </div>
        {(filter.conditions ?? []).length + groups.length > 1 && <ConjunctionToggle value={filter.conjunction} onChange={(conjunction) => onChange({ ...filter, conjunction })} />}
      </div>
    </div>
  );
}

/** The groups inside `parent`, each in its own box; a group can hold groups of its own (rendered the same way). */
function GroupBoxes({ fields, members, parent, onChange }: { fields: FieldRow[]; members: Member[]; parent: FilterGroup; onChange: (g: FilterGroup) => void }) {
  const { t } = useT();
  const groups = parent.groups ?? [];
  const setGroups = (next: FilterGroup[]) => onChange({ ...parent, groups: next });
  // A group left with nothing in it is removed: an empty group would only clutter the panel.
  const put = (gi: number, next: FilterGroup) => setGroups((next.conditions ?? []).length || (next.groups ?? []).length ? groups.map((x, i) => (i === gi ? next : x)) : groups.filter((_, i) => i !== gi));
  return (
    <>
      {groups.map((g, gi) => (
        <div key={gi} className="mt-2 flex items-start gap-1.5" data-testid="filter-group">
          <span className="w-10 pt-2 text-xs text-neutral-400 shrink-0">{!(parent.conditions ?? []).length && gi === 0 ? t("flt.where") : parent.conjunction === "OR" ? t("flt.orLower") : t("flt.andLower")}</span>
          <div className="flex-1 min-w-0 rounded-md border border-neutral-200 bg-neutral-50/60 p-2 dark:border-neutral-800 dark:bg-neutral-900/40">
            <ConditionList fields={fields} members={members} group={g} onChange={(next) => put(gi, next)} />
            <GroupBoxes fields={fields} members={members} parent={g} onChange={(next) => put(gi, next)} />
            <div className="mt-2 flex items-center justify-between">
              <AddConditionButton fields={fields} group={g} onChange={(next) => put(gi, next)} />
              {(g.conditions ?? []).length + (g.groups ?? []).length > 1 && <ConjunctionToggle small value={g.conjunction} onChange={(conjunction) => put(gi, { ...g, conjunction })} />}
            </div>
          </div>
          <button onClick={() => setGroups(groups.filter((_, i) => i !== gi))} className="mt-2 text-neutral-400 hover:text-red-600 shrink-0" aria-label={t("flt.removeGroup")}>
            <X size={14} />
          </button>
        </div>
      ))}
    </>
  );
}

function ConjunctionToggle({ value, onChange, small }: { value: FilterGroup["conjunction"]; onChange: (v: FilterGroup["conjunction"]) => void; small?: boolean }) {
  const { t } = useT();
  return (
    <div className={`flex items-center gap-1 ${small ? "text-[11px]" : "text-xs"}`}>
      {(["AND", "OR"] as const).map((c) => (
        <button key={c} onClick={() => onChange(c)} className={`px-2 py-0.5 rounded ${(value === "OR") === (c === "OR") ? "bg-neutral-800 text-white" : "text-neutral-400"}`}>
          {c === "AND" ? t("flt.and") : t("flt.or")}
        </button>
      ))}
    </div>
  );
}

function AddConditionButton({ fields, group, onChange }: { fields: FieldRow[]; group: FilterGroup; onChange: (g: FilterGroup) => void }) {
  const { t } = useT();
  return (
    <button
      onClick={() => {
        const field = fields[0];
        if (!field) return;
        const op = operatorsForType(field.type)[0]?.value ?? "contains";
        onChange({ ...group, conditions: [...(group.conditions ?? []), { id: nanoid(8), fieldId: field.id, operator: op }] });
      }}
      className="flex items-center gap-1 text-xs text-indigo-600 hover:underline"
    >
      <Plus size={12} /> {t("flt.add")}
    </button>
  );
}

/** The conditions of one group (its sub-groups are drawn by GroupBoxes). */
function ConditionList({ fields, members, group, onChange }: { fields: FieldRow[]; members: Member[]; group: FilterGroup; onChange: (g: FilterGroup) => void }) {
  const { t } = useT();
  const conditions = group.conditions ?? [];
  const update = (id: string, patch: Partial<FilterCondition>) => onChange({ ...group, conditions: conditions.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const remove = (id: string) => onChange({ ...group, conditions: conditions.filter((c) => c.id !== id) });
  return (
    <>
      <div className="space-y-2">
        {conditions.map((cond, idx) => {
          const field = fields.find((f) => f.id === cond.fieldId) ?? fields[0];
          const ops = field ? operatorsForType(field.type, t) : [];
          const needsValue = !NO_VALUE_OPS.includes(cond.operator);
          return (
            <div key={cond.id} className="flex items-center gap-1.5 min-w-0" data-testid="filter-condition">
              <span className="w-10 text-xs text-neutral-400 shrink-0">{idx === 0 ? t("flt.where") : group.conjunction === "OR" ? t("flt.orLower") : t("flt.andLower")}</span>
              <Select
                className="w-28 shrink-0"
                value={cond.fieldId}
                onValueChange={(v) => {
                  const f = fields.find((ff) => ff.id === v);
                  update(cond.id, { fieldId: v, operator: f ? operatorsForType(f.type)[0]?.value : cond.operator, value: undefined });
                }}
                options={fields.map((f) => ({ value: f.id, label: f.name }))}
              />
              <Select className="w-32 shrink-0" value={cond.operator} onValueChange={(v) => update(cond.id, { operator: v as FilterOperator })} options={ops} />
              {needsValue && field && <FilterValueInput field={field} value={cond.value} members={members} onChange={(v) => update(cond.id, { value: v })} />}
              <button onClick={() => remove(cond.id)} className="text-neutral-400 hover:text-red-600 shrink-0">
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </>
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
        className="flex-1 min-w-0"
        value={(value as string) ?? ""}
        onValueChange={onChange}
        options={(config.options ?? []).map((o) => ({ value: o.id, label: o.label }))}
      />
    );
  }
  if (["person", "people"].includes(field.type)) {
    return (
      <Select className="flex-1 min-w-0" value={(value as string) ?? ""} onValueChange={onChange} options={members.map((m) => ({ value: m.id, label: m.name }))} />
    );
  }
  if (["date", "datetime"].includes(field.type)) {
    return <Input type="date" className="flex-1 min-w-0" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />;
  }
  if (["number", "integer", "percent", "currency", "rating", "progress", "duration"].includes(field.type)) {
    return <Input type="number" className="flex-1 min-w-0" value={(value as number) ?? ""} onChange={(e) => onChange(Number(e.target.value))} />;
  }
  if (field.type === "checkbox") {
    return <Select className="flex-1 min-w-0" value={String(value ?? "true")} onValueChange={(v) => onChange(v === "true")} options={[{ value: "true", label: "Checked" }, { value: "false", label: "Unchecked" }]} />;
  }
  return <Input className="flex-1 min-w-0" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} placeholder="value" />;
}

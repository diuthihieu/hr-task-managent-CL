"use client";
import { Plus, X, ArrowUpDown } from "lucide-react";
import { Select } from "@/components/ui/misc";
import type { SortRule } from "@/lib/query-engine";
import type { FieldRow } from "@/types";

export function SortPanel({ fields, sorts, onChange }: { fields: FieldRow[]; sorts: SortRule[]; onChange: (s: SortRule[]) => void }) {
  function update(idx: number, patch: Partial<SortRule>) {
    onChange(sorts.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }
  function remove(idx: number) {
    onChange(sorts.filter((_, i) => i !== idx));
  }
  function add() {
    const used = new Set(sorts.map((s) => s.fieldId));
    const field = fields.find((f) => !used.has(f.id)) ?? fields[0];
    if (!field) return;
    onChange([...sorts, { fieldId: field.id, direction: "asc" }]);
  }

  return (
    <div className="w-96 p-3">
      <div className="flex items-center gap-2 mb-3 text-xs font-semibold text-neutral-500">
        <ArrowUpDown size={13} /> Sort records
      </div>
      {sorts.length === 0 && <p className="text-xs text-neutral-400 mb-2">No sorts applied</p>}
      <div className="space-y-2">
        {sorts.map((sort, idx) => (
          <div key={idx} className="flex items-center gap-1.5">
            <span className="w-10 text-xs text-neutral-400 shrink-0">{idx === 0 ? "Sort" : "then"}</span>
            <Select className="flex-1" value={sort.fieldId} onValueChange={(v) => update(idx, { fieldId: v })} options={fields.map((f) => ({ value: f.id, label: f.name }))} />
            <Select
              className="w-28 shrink-0"
              value={sort.direction}
              onValueChange={(v) => update(idx, { direction: v as "asc" | "desc" })}
              options={[{ value: "asc", label: "Ascending" }, { value: "desc", label: "Descending" }]}
            />
            <button onClick={() => remove(idx)} className="text-neutral-400 hover:text-red-600 shrink-0">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      <button onClick={add} className="flex items-center gap-1 text-xs text-indigo-600 hover:underline mt-3">
        <Plus size={12} /> Add sort
      </button>
    </div>
  );
}

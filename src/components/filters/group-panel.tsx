"use client";
import { Group as GroupIcon, X } from "lucide-react";
import { Select } from "@/components/ui/misc";
import type { GroupRule } from "@/lib/query-engine";
import type { FieldRow } from "@/types";

const GROUPABLE_TYPES = ["single_select", "multi_select", "status", "person", "people"];
const NUMERIC_TYPES = ["number", "integer", "percent", "currency", "rating", "progress", "duration"];

export function GroupPanel({ fields, group, onChange }: { fields: FieldRow[]; group: GroupRule | undefined; onChange: (g: GroupRule | undefined) => void }) {
  const groupable = fields.filter((f) => GROUPABLE_TYPES.includes(f.type));
  const numericFields = fields.filter((f) => NUMERIC_TYPES.includes(f.type));

  return (
    <div className="w-80 p-3">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-neutral-500">
          <GroupIcon size={13} /> Group by
        </div>
        {group?.fieldId && (
          <button onClick={() => onChange(undefined)} className="text-neutral-400 hover:text-red-600">
            <X size={13} />
          </button>
        )}
      </div>
      <Select
        className="w-full mb-2"
        value={group?.fieldId ?? ""}
        onValueChange={(v) => onChange({ fieldId: v })}
        options={groupable.map((f) => ({ value: f.id, label: f.name }))}
        placeholder="Select a field"
      />
      {groupable.length === 0 && <p className="text-xs text-neutral-400">No select/person fields to group by yet</p>}

      {group?.fieldId && numericFields.length > 0 && (
        <div className="mt-3 pt-3 border-t border-neutral-100 dark:border-neutral-800">
          <label className="text-xs text-neutral-500 mb-1 block">Summary</label>
          <div className="flex gap-1.5">
            <Select
              className="flex-1"
              value={group.aggFn ?? "count"}
              onValueChange={(v) => onChange({ ...group, aggFn: v as GroupRule["aggFn"] })}
              options={[
                { value: "count", label: "Count" },
                { value: "sum", label: "Sum" },
                { value: "avg", label: "Average" },
                { value: "min", label: "Min" },
                { value: "max", label: "Max" },
              ]}
            />
            {group.aggFn && group.aggFn !== "count" && (
              <Select
                className="flex-1"
                value={group.aggFieldId ?? ""}
                onValueChange={(v) => onChange({ ...group, aggFieldId: v })}
                options={numericFields.map((f) => ({ value: f.id, label: f.name }))}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

"use client";
import { Group as GroupIcon, X } from "lucide-react";
import { Select } from "@/components/ui/misc";
import { SELECT_SINGLE_TYPES } from "@/lib/field-types";
import type { GroupRule } from "@/lib/query-engine";
import type { FieldRow } from "@/types";
import { useT } from "@/components/i18n-provider";

const GROUPABLE_TYPES = [...SELECT_SINGLE_TYPES, "multi_select", "person", "people"];
const NUMERIC_TYPES = ["number", "integer", "percent", "currency", "rating", "progress", "duration"];

export function GroupPanel({ fields, group, onChange }: { fields: FieldRow[]; group: GroupRule | undefined; onChange: (g: GroupRule | undefined) => void }) {
  const { t } = useT();
  const groupable = fields.filter((f) => GROUPABLE_TYPES.includes(f.type));
  const numericFields = fields.filter((f) => NUMERIC_TYPES.includes(f.type));

  return (
    <div className="w-80 p-3">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-neutral-500">
          <GroupIcon size={13} /> {t("grp.title")}
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
        placeholder={t("flt.selectField")}
      />
      {groupable.length === 0 && <p className="text-xs text-neutral-400">{t("grp.noFields")}</p>}

      {group?.fieldId && numericFields.length > 0 && (
        <div className="mt-3 pt-3 border-t border-neutral-100 dark:border-neutral-800">
          <label className="text-xs text-neutral-500 mb-1 block">{t("grp.summary")}</label>
          <div className="flex gap-1.5">
            <Select
              className="flex-1"
              value={group.aggFn ?? "count"}
              onValueChange={(v) => onChange({ ...group, aggFn: v as GroupRule["aggFn"] })}
              options={[
                { value: "count", label: t("grp.count") },
                { value: "sum", label: t("report.agg.sum") },
                { value: "avg", label: t("report.agg.avg") },
                { value: "min", label: t("report.agg.min") },
                { value: "max", label: t("report.agg.max") },
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

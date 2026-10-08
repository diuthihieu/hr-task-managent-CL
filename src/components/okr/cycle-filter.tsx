"use client";
import { X } from "lucide-react";
import { Select } from "@/components/ui/misc";
import { useT } from "@/components/i18n-provider";

/** "" = all cycles; quarter / year = by cycle type; range = objectives overlapping from..to. */
export interface CycleFilterValue {
  cycle: "" | "quarter" | "year" | "range";
  from: string;
  to: string;
}
export const EMPTY_CYCLE_FILTER: CycleFilterValue = { cycle: "", from: "", to: "" };

/** Adds the filter's query params (cycleType, or from / to). */
export function applyCycleParams(params: URLSearchParams, v: CycleFilterValue) {
  if (v.cycle === "quarter" || v.cycle === "year") params.set("cycleType", v.cycle);
  if (v.cycle === "range") {
    if (v.from) params.set("from", v.from);
    if (v.to) params.set("to", v.to);
  }
}

export function CycleFilter({ value, onChange }: { value: CycleFilterValue; onChange: (v: CycleFilterValue) => void }) {
  const { t } = useT();
  const dateCls = "h-8 w-[8.5rem] rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-2 text-xs text-neutral-700 dark:text-neutral-200";
  return (
    <div className="flex items-center gap-1.5">
      <Select
        className="w-32"
        value={value.cycle}
        onValueChange={(v) => onChange({ ...value, cycle: v as CycleFilterValue["cycle"] })}
        options={[
          { value: "", label: t("okr.allCycles") },
          { value: "quarter", label: t("okr.cycle.quarter") },
          { value: "year", label: t("okr.cycle.year") },
          { value: "range", label: t("okr.cycle.range") },
        ]}
      />
      {value.cycle === "range" && (
        <>
          <input type="date" aria-label={t("okr.range.from")} title={t("okr.range.from")} value={value.from} max={value.to || undefined} onChange={(e) => onChange({ ...value, from: e.target.value })} className={dateCls} data-testid="okr-range-from" />
          <span className="text-xs text-neutral-400">–</span>
          <input type="date" aria-label={t("okr.range.to")} title={t("okr.range.to")} value={value.to} min={value.from || undefined} onChange={(e) => onChange({ ...value, to: e.target.value })} className={dateCls} data-testid="okr-range-to" />
          <button onClick={() => onChange(EMPTY_CYCLE_FILTER)} className="p-1 rounded text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200" aria-label={t("okr.range.clear")} title={t("okr.range.clear")}>
            <X size={13} />
          </button>
        </>
      )}
    </div>
  );
}

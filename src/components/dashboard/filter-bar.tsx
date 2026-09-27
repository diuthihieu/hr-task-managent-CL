"use client";
import { useState } from "react";
import { Plus, X, SlidersHorizontal } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import type { CrossFilter } from "@/lib/dashboard-engine";
import { nanoid } from "nanoid";
import { useT } from "@/components/i18n-provider";

// Dashboard-level "slicers": a persisted CrossFilter the user types in
// directly instead of deriving from a chart click - see dashboard-engine.ts
// for why both share the same {fieldName, label} matching mechanism.
export function DashboardFilterBar({
  fieldNames,
  slicers,
  onChange,
}: {
  fieldNames: string[];
  slicers: (CrossFilter & { id: string })[];
  onChange: (slicers: (CrossFilter & { id: string })[]) => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [fieldName, setFieldName] = useState("");
  const [mode, setMode] = useState<"value" | "before" | "after">("value");
  const [value, setValue] = useState("");

  function addSlicer() {
    if (!fieldName.trim() || !value.trim()) return;
    onChange([
      ...slicers,
      { id: nanoid(8), fieldName: fieldName.trim(), label: value.trim(), operator: mode === "value" ? "is" : mode },
    ]);
    setFieldName("");
    setValue("");
    setMode("value");
    setOpen(false);
  }

  function removeSlicer(id: string) {
    onChange(slicers.filter((s) => s.id !== id));
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="flex items-center gap-1 text-xs text-neutral-400">
        <SlidersHorizontal size={12} /> {t("db.slicers")}
      </span>
      {slicers.map((s) => (
        <span key={s.id} className="inline-flex items-center gap-1 rounded-full bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 text-xs">
          {s.fieldName} {s.operator === "before" ? "<" : s.operator === "after" ? ">" : "="} {s.label}
          <button onClick={() => removeSlicer(s.id)} className="hover:text-red-600">
            <X size={11} />
          </button>
        </span>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button className="flex items-center gap-1 text-xs text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-md px-2 py-1">
            <Plus size={12} /> {t("db.addSlicer")}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3 space-y-2">
          <div>
            <label className="text-[11px] font-medium text-neutral-500 mb-1 block">{t("db.slicerField")}</label>
            <Input list="dashboard-field-names" value={fieldName} onChange={(e) => setFieldName(e.target.value)} placeholder="Status" />
            <datalist id="dashboard-field-names">
              {fieldNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="text-[11px] font-medium text-neutral-500 mb-1 block">{t("db.condition")}</label>
            <Select
              className="w-full"
              value={mode}
              onValueChange={(v) => setMode(v as "value" | "before" | "after")}
              options={[
                { value: "value", label: t("db.eq") },
                { value: "before", label: t("db.before") },
                { value: "after", label: t("db.after") },
              ]}
            />
          </div>
          <div>
            <label className="text-[11px] font-medium text-neutral-500 mb-1 block">{t("flt.value")}</label>
            <Input type={mode === "value" ? "text" : "date"} value={value} onChange={(e) => setValue(e.target.value)} placeholder={mode === "value" ? "Done" : undefined} />
          </div>
          <Button className="w-full justify-center" onClick={addSlicer} disabled={!fieldName.trim() || !value.trim()}>
            Add
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}

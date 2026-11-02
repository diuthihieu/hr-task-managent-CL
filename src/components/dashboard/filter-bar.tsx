"use client";
import { useEffect, useMemo, useState } from "react";
import { Plus, X, SlidersHorizontal, ChevronDown, Search, RotateCcw, Save } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/misc";
import { DateInput } from "@/components/ui/date-input";
import { api } from "@/lib/api-client";
import type { CrossFilter } from "@/lib/dashboard-engine";
import { MAX_SLICER_VALUES, addSlicerValues, slicerActive, type SlicerDef, type SlicerSelection } from "@/lib/dashboard-slicers";
import { useT } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";
import { nanoid } from "nanoid";

type Options = { found: boolean; kind: "list" | "date"; values: { label: string; count: number }[]; min?: string; max?: string };

/** Selection part of a slicer (what the viewer picked), without its id. */
export const selectionOf = (s: SlicerSelection): SlicerSelection => ({ fieldName: s.fieldName, ...(s.values?.length ? { values: s.values } : {}), ...(s.from ? { from: s.from } : {}), ...(s.to ? { to: s.to } : {}) });
const sameSelection = (a: SlicerSelection, b: SlicerSelection) => JSON.stringify(selectionOf(a)) === JSON.stringify(selectionOf(b));
const shortDay = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/**
 * D3: the dashboard's slicers, like Power BI's - a dropdown per slicer with search, Select all, Clear
 * and counts (linked to the other slicers), or a date range; Reset filters goes back to the author's
 * default. Each viewer's selection is their own; editors save the current one as the default.
 */
export function DashboardFilterBar({
  dashboardId,
  fieldNames,
  defs,
  current,
  crossFilter,
  canEdit,
  onSelect,
  onDefsChange,
  onReset,
}: {
  dashboardId: string;
  fieldNames: string[];
  /** Saved slicers (with the author's default selection). */
  defs: SlicerDef[];
  /** This viewer's current selection, one per def (same order). */
  current: SlicerDef[];
  crossFilter: CrossFilter | null;
  canEdit: boolean;
  onSelect: (id: string, selection: SlicerSelection) => void;
  onDefsChange: (defs: SlicerDef[]) => void;
  onReset: () => void;
}) {
  const { t } = useT();
  const [adding, setAdding] = useState(false);
  const [newField, setNewField] = useState("");
  const changed = current.some((c, i) => defs[i] && !sameSelection(c, defs[i])) || !!crossFilter;
  const active = current.filter(slicerActive).length + (crossFilter ? 1 : 0);

  function addSlicer() {
    const name = newField.trim();
    if (!name) return;
    onDefsChange([...defs, { id: nanoid(8), fieldName: name }]);
    setNewField("");
    setAdding(false);
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap" data-testid="slicer-bar">
      <span className="flex items-center gap-1 text-xs text-neutral-400">
        <SlidersHorizontal size={12} /> {t("db.slicers")}
      </span>
      {current.map((s) => (
        <SlicerButton
          key={s.id}
          dashboardId={dashboardId}
          slicer={s}
          all={current}
          crossFilter={crossFilter}
          canEdit={canEdit}
          onChange={(sel) => onSelect(s.id, sel)}
          onRemove={() => onDefsChange(defs.filter((d) => d.id !== s.id))}
        />
      ))}
      {canEdit && (
        <Popover open={adding} onOpenChange={setAdding}>
          <PopoverTrigger asChild>
            <button className="flex items-center gap-1 text-xs text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-md px-2 py-1" data-testid="slicer-add">
              <Plus size={12} /> {t("db.addSlicer")}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-3 space-y-2">
            <label className="text-[11px] font-medium text-neutral-500 block">{t("db.slicerField")}</label>
            <Input list="dashboard-field-names" value={newField} onChange={(e) => setNewField(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addSlicer()} placeholder="Status" data-testid="slicer-add-field" />
            <datalist id="dashboard-field-names">
              {fieldNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            <button className="w-full rounded-md bg-indigo-600 text-white text-xs py-1.5 disabled:opacity-50" onClick={addSlicer} disabled={!newField.trim()} data-testid="slicer-add-confirm">
              {t("db.addSlicer")}
            </button>
          </PopoverContent>
        </Popover>
      )}
      {active > 0 && <span className="text-[11px] text-neutral-400" data-testid="slicer-active-count">{t("db.slicerActive", { count: active })}</span>}
      {changed && (
        <button onClick={onReset} className="flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950 rounded-md px-2 py-1" data-testid="slicer-reset">
          <RotateCcw size={12} /> {t("db.resetFilters")}
        </button>
      )}
      {canEdit && current.some((c, i) => defs[i] && !sameSelection(c, defs[i])) && (
        <button
          onClick={() => onDefsChange(current.map((c) => ({ id: c.id, ...selectionOf(c) })))}
          className="flex items-center gap-1 text-xs text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-md px-2 py-1"
          title={t("db.saveDefaultHint")}
          data-testid="slicer-save-default"
        >
          <Save size={12} /> {t("db.saveDefault")}
        </button>
      )}
    </div>
  );
}

function SlicerButton({
  dashboardId,
  slicer,
  all,
  crossFilter,
  canEdit,
  onChange,
  onRemove,
}: {
  dashboardId: string;
  slicer: SlicerDef;
  all: SlicerDef[];
  crossFilter: CrossFilter | null;
  canEdit: boolean;
  onChange: (s: SlicerSelection) => void;
  onRemove: () => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Options | null>(null);
  const [query, setQuery] = useState("");
  const others = JSON.stringify(all.filter((s) => s.id !== slicer.id).map(selectionOf));

  // Options follow the other slicers and a chart click (linked slicers); fetched when opened.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api
      .post<Options>(`/api/dashboards/${dashboardId}/slicer-options`, { fieldName: slicer.fieldName, slicers: JSON.parse(others), crossFilter })
      .then((o) => !cancelled && setOptions(o))
      .catch(() => !cancelled && setOptions({ found: false, kind: "list", values: [] }));
    return () => {
      cancelled = true;
    };
  }, [open, dashboardId, slicer.fieldName, others, crossFilter]);

  const picked = useMemo(() => slicer.values ?? [], [slicer.values]);
  const isDate = options?.kind === "date" || ((slicer.from || slicer.to) && !picked.length);
  const summary = isDate && picked.length
    ? picked.join(", ")
    : isDate
    ? slicer.from || slicer.to
      ? `${slicer.from ? shortDay(slicer.from) : "…"} – ${slicer.to ? shortDay(slicer.to) : "…"}`
      : t("db.slicerAll")
    : picked.length
      ? picked.length <= 2
        ? picked.join(", ")
        : `${picked.slice(0, 2).join(", ")} +${picked.length - 2}`
      : t("db.slicerAll");

  // Picked values the current data doesn't have stay listed (count 0) - a selection is never dropped.
  const listed = useMemo(() => {
    const values = options?.values ?? [];
    const have = new Set(values.map((v) => v.label.toLowerCase()));
    return [...picked.filter((p) => !have.has(p.toLowerCase())).map((label) => ({ label, count: 0 })), ...values];
  }, [options, picked]);
  const shown = listed.filter((v) => v.label.toLowerCase().includes(query.trim().toLowerCase()));
  const isPicked = (label: string) => picked.some((p) => p.toLowerCase() === label.toLowerCase());
  const allShownPicked = shown.length > 0 && shown.every((v) => isPicked(v.label));

  // At most MAX_SLICER_VALUES picked: what is ticked is exactly what filters (the server keeps no more).
  const [capped, setCapped] = useState(false);
  function toggle(label: string) {
    if (isPicked(label)) {
      setCapped(false);
      return onChange({ fieldName: slicer.fieldName, values: picked.filter((p) => p.toLowerCase() !== label.toLowerCase()) });
    }
    const next = addSlicerValues(picked, [label]);
    setCapped(next.capped);
    onChange({ fieldName: slicer.fieldName, values: next.values });
  }

  function selectAll() {
    if (allShownPicked) {
      setCapped(false);
      return onChange({ fieldName: slicer.fieldName, values: picked.filter((p) => !shown.some((v) => v.label.toLowerCase() === p.toLowerCase())) });
    }
    const next = addSlicerValues(picked, shown.map((v) => v.label));
    setCapped(next.capped);
    onChange({ fieldName: slicer.fieldName, values: next.values });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs border max-w-[260px]",
            slicerActive(slicer) ? "bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800" : "border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300",
          )}
          data-testid="slicer"
          data-slicer-field={slicer.fieldName}
        >
          <span className="font-medium shrink-0">{slicer.fieldName}:</span>
          <span className="truncate">{summary}</span>
          <ChevronDown size={11} className="shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        {!options ? (
          <div className="p-3 text-xs text-neutral-400">{t("db.loading")}</div>
        ) : !options.found ? (
          <div className="p-3 text-xs text-neutral-500">{t("db.slicerNoField", { field: slicer.fieldName })}</div>
        ) : options.kind === "date" ? (
          <div className="p-3 space-y-2" data-testid="slicer-date">
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11px] text-neutral-500">
                {t("db.slicerFrom")}
                <DateInput value={slicer.from ?? ""} onCommit={(v) => onChange({ fieldName: slicer.fieldName, from: v ?? undefined, to: slicer.to })} data-testid="slicer-from" />
              </label>
              <label className="text-[11px] text-neutral-500">
                {t("db.slicerTo")}
                <DateInput value={slicer.to ?? ""} onCommit={(v) => onChange({ fieldName: slicer.fieldName, from: slicer.from, to: v ?? undefined })} data-testid="slicer-to" />
              </label>
            </div>
            {options.min && <p className="text-[11px] text-neutral-400">{t("db.slicerRange", { from: shortDay(options.min), to: shortDay(options.max ?? options.min) })}</p>}
            <p className="text-[11px] text-neutral-400">{t("db.slicerInclusive")}</p>
            <div className="flex justify-end">
              <button className="text-xs text-neutral-500 hover:text-red-600 disabled:opacity-40" disabled={!slicer.from && !slicer.to && !picked.length} onClick={() => onChange({ fieldName: slicer.fieldName })} data-testid="slicer-clear">
                {t("db.slicerClear")}
              </button>
            </div>
          </div>
        ) : (
          <div data-testid="slicer-list">
            <div className="p-2 border-b border-neutral-100 dark:border-neutral-800">
              <div className="relative">
                <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-400" />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("db.slicerSearch")} className="pl-6 h-7 text-xs" data-testid="slicer-search" />
              </div>
            </div>
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-neutral-100 dark:border-neutral-800">
              <label className="flex items-center gap-2 text-xs cursor-pointer" data-testid="slicer-select-all">
                <Checkbox checked={allShownPicked} onCheckedChange={selectAll} /> {t("db.slicerSelectAll")}
              </label>
              <button className="text-xs text-neutral-500 hover:text-red-600 disabled:opacity-40" disabled={!picked.length} onClick={() => onChange({ fieldName: slicer.fieldName })} data-testid="slicer-clear">
                {t("db.slicerClear")}
              </button>
            </div>
            {capped && (
              <p className="px-3 py-1 text-[11px] text-amber-600 dark:text-amber-400 border-b border-neutral-100 dark:border-neutral-800" data-testid="slicer-capped">
                {t("db.slicerCapped", { max: MAX_SLICER_VALUES })}
              </p>
            )}
            <div className="max-h-64 overflow-y-auto thin-scroll py-1">
              {shown.length === 0 && <p className="px-3 py-2 text-xs text-neutral-400">{t("db.slicerNoValues")}</p>}
              {shown.map((v) => (
                <label key={v.label} className={cn("flex items-center gap-2 px-3 py-1 text-xs cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800", v.count === 0 && "text-neutral-400")} data-testid="slicer-value" data-value={v.label}>
                  <Checkbox checked={isPicked(v.label)} onCheckedChange={() => toggle(v.label)} />
                  <span className="flex-1 truncate">{v.label}</span>
                  <span className="tabular-nums text-neutral-400">{v.count}</span>
                </label>
              ))}
            </div>
          </div>
        )}
        {canEdit && (
          <div className="border-t border-neutral-100 dark:border-neutral-800 px-3 py-1.5 flex justify-end">
            <button className="flex items-center gap-1 text-[11px] text-neutral-400 hover:text-red-600" onClick={onRemove} data-testid="slicer-remove">
              <X size={11} /> {t("db.slicerRemove")}
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

"use client";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { CHART_TYPES, AGGREGATION_LABELS, type DashboardBlockConfig, type ChartType, type Aggregation, type WidgetStyleConfig } from "@/lib/dashboard-engine";
import type { FieldRow, ViewRow } from "@/types";
import { useT } from "@/components/i18n-provider";

export interface BlockDraft {
  type: ChartType;
  title: string;
  config: DashboardBlockConfig;
}

const DATE_TYPES = ["date", "datetime", "created_time", "modified_time"];
const NEEDS_DIMENSION: ChartType[] = ["bar", "column", "line", "area", "pie", "donut", "combo", "radar", "treemap", "funnel"];
const NEEDS_SERIES: ChartType[] = ["stacked_column", "stacked_bar"];
const NEEDS_MEASURE2: ChartType[] = ["combo", "scatter"];
const NEEDS_MEASURE: ChartType[] = [...NEEDS_DIMENSION, ...NEEDS_SERIES, ...NEEDS_MEASURE2, "kpi", "gauge"];

function defaultDraft(): BlockDraft {
  return { type: "column", title: "", config: { aggregation: "count", dataSource: {} } };
}

export function WidgetEditorDialog({
  open,
  onOpenChange,
  projects,
  initial,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projects: { id: string; name: string }[];
  initial: BlockDraft | null;
  onSave: (draft: BlockDraft) => void;
}) {
  const { t } = useT();
  function makeDraft(): BlockDraft {
    return initial ? { ...initial, config: { ...initial.config } } : defaultDraft();
  }

  const [draft, setDraft] = useState<BlockDraft>(makeDraft);
  const [wasOpen, setWasOpen] = useState(false);
  const [fields, setFields] = useState<FieldRow[]>([]);
  const [views, setViews] = useState<ViewRow[]>([]);

  if (open && !wasOpen) {
    setWasOpen(true);
    setDraft(makeDraft());
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }

  const projectId = draft.config.dataSource?.projectId;

  useEffect(() => {
    if (!open || !projectId) return;
    let cancelled = false;
    api
      .get<{ fields: FieldRow[]; views: ViewRow[] }>(`/api/projects/${projectId}`)
      .then((detail) => {
        if (cancelled) return;
        setFields(detail.fields);
        setViews(detail.views);
      })
      .catch(() => {
        if (!cancelled) {
          setFields([]);
          setViews([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  function patchConfig(patch: Partial<DashboardBlockConfig>) {
    setDraft((d) => ({ ...d, config: { ...d.config, ...patch } }));
  }

  function patchStyle(patch: Partial<WidgetStyleConfig>) {
    patchConfig({ style: { ...draft.config.style, ...patch } });
  }

  const dimensionField = fields.find((f) => f.id === draft.config.dimensionFieldId);
  const showDateBucket = dimensionField && DATE_TYPES.includes(dimensionField.type);
  const needsDimension = NEEDS_DIMENSION.includes(draft.type) || NEEDS_SERIES.includes(draft.type);
  const needsSeries = NEEDS_SERIES.includes(draft.type);
  const needsMeasure = NEEDS_MEASURE.includes(draft.type);
  const needsMeasure2 = NEEDS_MEASURE2.includes(draft.type);
  const isTable = draft.type === "table";
  const isNetwork = draft.type === "network";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto thin-scroll">
        <DialogTitle>{initial ? t("db.editWidget") : t("db.addWidget")}</DialogTitle>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("db.w.title")}</label>
            <Input value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} placeholder="e.g. Tasks by Status" />
          </div>

          <div>
            <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("db.w.type")}</label>
            <Select
              className="w-full"
              value={draft.type}
              onValueChange={(v) => setDraft((d) => ({ ...d, type: v as ChartType }))}
              options={CHART_TYPES.map((c) => ({ value: c.type, label: c.label }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("db.w.project")}</label>
              <Select
                className="w-full"
                value={projectId ?? ""}
                onValueChange={(v) => {
                  patchConfig({ dataSource: { projectId: v, viewId: undefined }, dimensionFieldId: undefined, measureFieldId: undefined });
                }}
                options={projects.map((t) => ({ value: t.id, label: t.name }))}
                placeholder={t("db.w.chooseProject")}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("db.w.view")}</label>
              <Select
                className="w-full"
                value={draft.config.dataSource?.viewId ?? ""}
                onValueChange={(v) => patchConfig({ dataSource: { projectId, viewId: v || undefined } })}
                options={[{ value: "", label: t("db.w.allRecords") }, ...views.map((v) => ({ value: v.id, label: v.name }))]}
                placeholder={t("db.w.allRecords")}
              />
            </div>
          </div>

          {isTable ? (
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("db.w.columns")}</label>
              <div className="max-h-32 overflow-y-auto thin-scroll border border-neutral-200 dark:border-neutral-800 rounded-md p-1.5 space-y-1">
                {fields.map((f) => {
                  const selected = draft.config.tableFieldIds?.includes(f.id) ?? true;
                  return (
                    <label key={f.id} className="flex items-center gap-2 text-sm px-1 py-0.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={(e) => {
                          const current = draft.config.tableFieldIds ?? fields.map((ff) => ff.id);
                          patchConfig({ tableFieldIds: e.target.checked ? [...current, f.id] : current.filter((id) => id !== f.id) });
                        }}
                      />
                      {f.name}
                    </label>
                  );
                })}
              </div>
            </div>
          ) : isNetwork ? (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("db.w.linkField")}</label>
                <Select
                  className="w-full"
                  value={draft.config.networkLinkFieldId ?? ""}
                  onValueChange={(v) => patchConfig({ networkLinkFieldId: v })}
                  options={fields.filter((field) => field.type === "link").map((field) => ({ value: field.id, label: field.name }))}
                  placeholder={t("form.chooseField")}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("db.w.nodeLabel")}</label>
                <Select
                  className="w-full"
                  value={draft.config.networkLabelFieldId ?? "sys_title"}
                  onValueChange={(v) => patchConfig({ networkLabelFieldId: v })}
                  options={fields.map((field) => ({ value: field.id, label: field.name }))}
                  placeholder={t("form.chooseField")}
                />
              </div>
            </div>
          ) : (
            <>
              {needsDimension && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("db.w.dimension")}</label>
                    <Select
                      className="w-full"
                      value={draft.config.dimensionFieldId ?? ""}
                      onValueChange={(v) => patchConfig({ dimensionFieldId: v })}
                      options={fields.map((f) => ({ value: f.id, label: f.name }))}
                      placeholder={t("form.chooseField")}
                    />
                  </div>
                  {showDateBucket && (
                    <div>
                      <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("db.w.bucket")}</label>
                      <Select
                        className="w-full"
                        value={draft.config.dateBucket ?? "day"}
                        onValueChange={(v) => patchConfig({ dateBucket: v as "day" | "week" | "month" })}
                        options={[{ value: "day", label: t("report.bucket.day") }, { value: "week", label: t("report.bucket.week") }, { value: "month", label: t("report.bucket.month") }]}
                      />
                    </div>
                  )}
                </div>
              )}

              {needsSeries && (
                <div>
                  <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("db.w.series")}</label>
                  <Select
                    className="w-full"
                    value={draft.config.dimension2FieldId ?? ""}
                    onValueChange={(v) => patchConfig({ dimension2FieldId: v })}
                    options={fields.map((f) => ({ value: f.id, label: f.name }))}
                    placeholder={t("form.chooseField")}
                  />
                </div>
              )}

              {needsMeasure && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("db.w.measure")}{needsMeasure2 ? " (Y)" : ""}</label>
                    <Select
                      className="w-full"
                      value={draft.config.measureFieldId ?? ""}
                      onValueChange={(v) => patchConfig({ measureFieldId: v })}
                      options={fields.map((f) => ({ value: f.id, label: f.name }))}
                      placeholder={t("db.w.recordCount")}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("db.w.aggregation")}</label>
                    <Select
                      className="w-full"
                      value={draft.config.aggregation ?? "count"}
                      onValueChange={(v) => patchConfig({ aggregation: v as Aggregation })}
                      options={Object.entries(AGGREGATION_LABELS).map(([value, label]) => ({ value, label }))}
                    />
                  </div>
                </div>
              )}

              {draft.type === "kpi" && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("db.w.compare")}</label>
                    <Select
                      className="w-full"
                      value={draft.config.kpiCompareTo ?? "none"}
                      onValueChange={(v) => patchConfig({ kpiCompareTo: v as DashboardBlockConfig["kpiCompareTo"] })}
                      options={[
                        { value: "none", label: t("db.w.compareNone") },
                        { value: "previous_week", label: t("db.w.previousWeek") },
                        { value: "previous_month", label: t("db.w.previousMonth") },
                        { value: "previous_quarter", label: t("db.w.previousQuarter") },
                        { value: "previous_year", label: t("db.w.previousYear") },
                      ]}
                    />
                  </div>
                  {draft.config.kpiCompareTo && draft.config.kpiCompareTo !== "none" && (
                    <div>
                      <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("db.w.dateField")}</label>
                      <Select
                        className="w-full"
                        value={draft.config.kpiDateFieldId ?? ""}
                        onValueChange={(v) => patchConfig({ kpiDateFieldId: v })}
                        options={fields.filter((field) => DATE_TYPES.includes(field.type)).map((field) => ({ value: field.id, label: field.name }))}
                        placeholder={t("form.chooseField")}
                      />
                    </div>
                  )}
                </div>
              )}

              {needsMeasure2 && (
                <div>
                  <label className="text-xs font-medium text-neutral-500 mb-1 block">{draft.type === "scatter" ? t("db.w.measureX") : t("db.w.measure2")}</label>
                  <Select
                    className="w-full"
                    value={draft.config.measure2FieldId ?? ""}
                    onValueChange={(v) => patchConfig({ measure2FieldId: v })}
                    options={fields.map((f) => ({ value: f.id, label: f.name }))}
                    placeholder={t("form.chooseField")}
                  />
                </div>
              )}

              {draft.type === "gauge" && (
                <div>
                  <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("db.w.gaugeMax")}</label>
                  <Input
                    type="number"
                    className="w-28"
                    value={draft.config.gaugeMax ?? 100}
                    onChange={(e) => patchConfig({ gaugeMax: Number(e.target.value) })}
                  />
                </div>
              )}

              {needsDimension && !needsSeries && (
                <div>
                  <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("db.w.top")}</label>
                  <Input
                    type="number"
                    className="w-28"
                    value={draft.config.topN ?? ""}
                    onChange={(e) => patchConfig({ topN: e.target.value ? Number(e.target.value) : undefined })}
                    placeholder={t("report.f.all")}
                  />
                </div>
              )}
            </>
          )}

          <details className="rounded-lg border border-neutral-200 dark:border-neutral-800" open>
            <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-neutral-700 dark:text-neutral-200">{t("db.style.title")}</summary>
            <div className="border-t border-neutral-100 dark:border-neutral-800 p-3 space-y-3">
              <div>
                <label className="text-xs font-medium text-neutral-500 mb-1.5 block">{t("db.style.palette")}</label>
                <div className="flex items-center gap-2">
                  {(draft.config.style?.palette?.length ? draft.config.style.palette : ["#6366f1", "#0ea5e9", "#22c55e", "#f97316", "#ec4899"]).slice(0, 5).map((color, index, palette) => (
                    <input
                      key={index}
                      type="color"
                      value={color}
                      onChange={(event) => {
                        const next = [...palette];
                        next[index] = event.target.value;
                        patchStyle({ palette: next });
                      }}
                      className="h-8 w-10 cursor-pointer rounded border border-neutral-200 bg-transparent p-0.5"
                      aria-label={`${t("db.style.color")} ${index + 1}`}
                    />
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <ColorControl label={t("db.style.background")} value={draft.config.style?.backgroundColor ?? "#ffffff"} onChange={(backgroundColor) => patchStyle({ backgroundColor })} />
                <ColorControl label={t("db.style.text")} value={draft.config.style?.textColor ?? "#171717"} onChange={(textColor) => patchStyle({ textColor })} />
                <ColorControl label={t("db.style.border")} value={draft.config.style?.borderColor ?? "#e5e7eb"} onChange={(borderColor) => patchStyle({ borderColor })} />
                <ColorControl label={t("db.style.grid")} value={draft.config.style?.gridColor ?? "#d1d5db"} onChange={(gridColor) => patchStyle({ gridColor })} />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("db.style.font")}</label>
                  <Select
                    className="w-full"
                    value={draft.config.style?.fontFamily ?? "system"}
                    onValueChange={(fontFamily) => patchStyle({ fontFamily: fontFamily as WidgetStyleConfig["fontFamily"] })}
                    options={[
                      { value: "system", label: "System" },
                      { value: "inter", label: "Inter" },
                      { value: "georgia", label: "Georgia" },
                      { value: "mono", label: "Monospace" },
                    ]}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("db.style.titleAlign")}</label>
                  <Select
                    className="w-full"
                    value={draft.config.style?.titleAlign ?? "left"}
                    onValueChange={(titleAlign) => patchStyle({ titleAlign: titleAlign as WidgetStyleConfig["titleAlign"] })}
                    options={[
                      { value: "left", label: t("db.style.left") },
                      { value: "center", label: t("db.style.center") },
                      { value: "right", label: t("db.style.right") },
                    ]}
                  />
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2">
                <NumberStyle label={t("db.style.fontSize")} min={9} max={20} value={draft.config.style?.fontSize ?? 11} onChange={(fontSize) => patchStyle({ fontSize })} />
                <NumberStyle label={t("db.style.titleSize")} min={10} max={28} value={draft.config.style?.titleSize ?? 12} onChange={(titleSize) => patchStyle({ titleSize })} />
                <NumberStyle label={t("db.style.radius")} min={0} max={32} value={draft.config.style?.borderRadius ?? 8} onChange={(borderRadius) => patchStyle({ borderRadius })} />
                <NumberStyle label={t("db.style.borderWidth")} min={0} max={6} value={draft.config.style?.borderWidth ?? 1} onChange={(borderWidth) => patchStyle({ borderWidth })} />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <NumberStyle label={t("db.style.lineWidth")} min={1} max={8} value={draft.config.style?.lineWidth ?? 2} onChange={(lineWidth) => patchStyle({ lineWidth })} />
                <NumberStyle label={t("db.style.barRadius")} min={0} max={24} value={draft.config.style?.barRadius ?? 4} onChange={(barRadius) => patchStyle({ barRadius })} />
                <NumberStyle label={t("db.style.donutHole")} min={20} max={80} value={draft.config.style?.donutInnerRadius ?? 55} onChange={(donutInnerRadius) => patchStyle({ donutInnerRadius })} />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("db.style.shadow")}</label>
                  <Select
                    className="w-full"
                    value={draft.config.style?.shadow ?? "none"}
                    onValueChange={(shadow) => patchStyle({ shadow: shadow as WidgetStyleConfig["shadow"] })}
                    options={[
                      { value: "none", label: t("common.none") },
                      { value: "small", label: t("db.style.small") },
                      { value: "medium", label: t("db.style.medium") },
                      { value: "large", label: t("db.style.large") },
                    ]}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("db.style.titleWeight")}</label>
                  <Select
                    className="w-full"
                    value={draft.config.style?.titleWeight ?? "medium"}
                    onValueChange={(titleWeight) => patchStyle({ titleWeight: titleWeight as WidgetStyleConfig["titleWeight"] })}
                    options={[
                      { value: "normal", label: t("db.style.normal") },
                      { value: "medium", label: t("db.style.medium") },
                      { value: "bold", label: t("db.style.bold") },
                    ]}
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-neutral-600 dark:text-neutral-300">
                <ToggleStyle label={t("db.style.legend")} checked={draft.config.style?.showLegend !== false} onChange={(showLegend) => patchStyle({ showLegend })} />
                <ToggleStyle label={t("db.style.gridLines")} checked={draft.config.style?.showGrid !== false} onChange={(showGrid) => patchStyle({ showGrid })} />
                <ToggleStyle label={t("db.style.dataLabels")} checked={draft.config.style?.showDataLabels === true} onChange={(showDataLabels) => patchStyle({ showDataLabels })} />
              </div>
            </div>
          </details>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => onSave(draft)} disabled={!projectId || (isNetwork && !draft.config.networkLinkFieldId)}>
            {t("common.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ColorControl({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex items-center justify-between gap-2 rounded-md border border-neutral-200 dark:border-neutral-800 px-2 py-1.5 text-xs text-neutral-500">
      <span>{label}</span>
      <input type="color" value={value} onChange={(event) => onChange(event.target.value)} className="h-6 w-9 cursor-pointer bg-transparent p-0" />
    </label>
  );
}

function NumberStyle({ label, min, max, value, onChange }: { label: string; min: number; max: number; value: number; onChange: (value: number) => void }) {
  return (
    <label className="text-[11px] text-neutral-500">
      <span className="mb-1 block truncate" title={label}>{label}</span>
      <Input type="number" min={min} max={max} value={value} onChange={(event) => onChange(Math.max(min, Math.min(max, Number(event.target.value))))} />
    </label>
  );
}

function ToggleStyle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="inline-flex items-center gap-1.5 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

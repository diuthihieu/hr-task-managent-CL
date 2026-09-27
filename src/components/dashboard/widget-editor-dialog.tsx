"use client";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { CHART_TYPES, AGGREGATION_LABELS, type DashboardBlockConfig, type ChartType, type Aggregation } from "@/lib/dashboard-engine";
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

  const dimensionField = fields.find((f) => f.id === draft.config.dimensionFieldId);
  const showDateBucket = dimensionField && DATE_TYPES.includes(dimensionField.type);
  const needsDimension = NEEDS_DIMENSION.includes(draft.type) || NEEDS_SERIES.includes(draft.type);
  const needsSeries = NEEDS_SERIES.includes(draft.type);
  const needsMeasure = NEEDS_MEASURE.includes(draft.type);
  const needsMeasure2 = NEEDS_MEASURE2.includes(draft.type);
  const isTable = draft.type === "table";

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
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => onSave(draft)} disabled={!projectId}>
            {t("common.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

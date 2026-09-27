"use client";
import { useMemo, useState } from "react";
import { nanoid } from "nanoid";
import { BarChart3, Plus, MoreHorizontal, Pencil, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { ChartRenderer } from "@/components/dashboard/chart-renderer";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/misc";
import { useT } from "@/components/i18n-provider";
import { computeSeries, computeStackedSeries, computeKpi, type DashboardBlockConfig } from "@/lib/dashboard-engine";
import type { MemberLite, ReportChartType, ReportConfig, ReportWidget } from "@/lib/query-engine";
import type { TFunction } from "@/lib/i18n/core";
import { cn } from "@/lib/utils";
import type { FieldRow, RecordRow } from "@/types";

const NUMERIC_TYPES = ["number", "currency", "percent", "rating", "progress", "integer"];
const DIMENSION_TYPES = ["status", "single_select", "multi_select", "people", "person", "date", "datetime", "created_time", "modified_time", "created_by", "okr_target", "importance", "urgency", "text", "checkbox"];
const DATE_TYPES = ["date", "datetime", "created_time", "modified_time"];
const STACKED: ReportChartType[] = ["stacked_column", "stacked_bar", "pivot"];
const CHART_TYPES: ReportChartType[] = ["column", "bar", "stacked_column", "stacked_bar", "line", "area", "pie", "donut", "pivot", "kpi"];

function toBlock(w: ReportWidget): DashboardBlockConfig {
  return {
    dimensionFieldId: w.dimensionFieldId,
    dimension2FieldId: w.dimension2FieldId,
    measureFieldId: w.aggregation && w.aggregation !== "count" ? w.measureFieldId : undefined,
    aggregation: w.aggregation ?? "count",
    dateBucket: w.dateBucket,
    sortDesc: w.sortDesc,
    topN: w.topN,
  };
}

function formatNumber(n: number) {
  return Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** Presets built from the fields this project actually has. */
function presets(fields: FieldRow[], t: TFunction): ReportWidget[] {
  const has = (id: string) => fields.some((f) => f.id === id);
  const list: ReportWidget[] = [{ id: "", title: t("report.preset.total"), type: "kpi", aggregation: "count" }];
  if (has("sys_assignees")) list.push({ id: "", title: t("report.preset.hoursByAssignee"), type: "bar", dimensionFieldId: "sys_assignees", measureFieldId: "sys_estimate", aggregation: "sum" });
  if (has("sys_category")) list.push({ id: "", title: t("report.preset.tasksByCategory"), type: "pie", dimensionFieldId: "sys_category", aggregation: "count" });
  if (has("sys_status")) list.push({ id: "", title: t("report.preset.tasksByStatus"), type: "column", dimensionFieldId: "sys_status", aggregation: "count" });
  if (has("sys_status") && has("sys_assignees")) list.push({ id: "", title: t("report.preset.statusByAssignee"), type: "pivot", dimensionFieldId: "sys_assignees", dimension2FieldId: "sys_status", aggregation: "count", wide: true });
  if (has("sys_objective")) list.push({ id: "", title: t("report.preset.progressByObjective"), type: "bar", dimensionFieldId: "sys_objective", measureFieldId: "sys_progress", aggregation: "avg" });
  if (has("sys_due_date")) list.push({ id: "", title: t("report.preset.dueByMonth"), type: "line", dimensionFieldId: "sys_due_date", dateBucket: "month", aggregation: "count" });
  list.push({ id: "", title: t("report.preset.tasksByName"), type: "bar", dimensionFieldId: "sys_title", aggregation: "count", topN: 15 });
  return list;
}

/**
 * Report view: a user-built set of charts and pivot tables over the view's
 * tasks (Power BI-style, but configured in the browser and saved in the
 * view's config). Uses the same aggregation engine as workspace dashboards.
 */
export function ReportView({
  fields,
  records,
  members,
  config,
  canEdit,
  onConfigChange,
}: {
  fields: FieldRow[];
  records: RecordRow[];
  members: MemberLite[];
  config: ReportConfig;
  canEdit: boolean;
  onConfigChange: (next: ReportConfig) => void;
}) {
  const { t } = useT();
  const widgets = config.widgets ?? [];
  const [editing, setEditing] = useState<ReportWidget | null>(null);

  function saveWidget(w: ReportWidget) {
    const next = w.id && widgets.some((x) => x.id === w.id) ? widgets.map((x) => (x.id === w.id ? w : x)) : [...widgets, { ...w, id: w.id || nanoid(8) }];
    onConfigChange({ ...config, widgets: next });
    setEditing(null);
  }
  function remove(id: string) {
    onConfigChange({ ...config, widgets: widgets.filter((w) => w.id !== id) });
  }
  function move(id: string, dir: -1 | 1) {
    const i = widgets.findIndex((w) => w.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= widgets.length) return;
    const next = [...widgets];
    [next[i], next[j]] = [next[j], next[i]];
    onConfigChange({ ...config, widgets: next });
  }

  const presetList = useMemo(() => presets(fields, t), [fields, t]);

  return (
    <div className="flex-1 overflow-y-auto thin-scroll p-4">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-xs text-neutral-500">{t("report.basedOn", { count: records.length })}</span>
        {canEdit && (
          <Button size="sm" className="ml-auto" onClick={() => setEditing({ id: "", title: "", type: "column", aggregation: "count" })} data-testid="report-add-chart">
            <Plus size={13} /> {t("report.addChart")}
          </Button>
        )}
      </div>

      {widgets.length === 0 && (
        <div className="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-8 text-center">
          <BarChart3 size={32} className="mx-auto text-indigo-500 mb-2" />
          <h3 className="font-semibold text-neutral-800 dark:text-neutral-100">{t("report.empty.title")}</h3>
          <p className="text-sm text-neutral-500 max-w-xl mx-auto mt-1">{t("report.empty.body")}</p>
          {canEdit && (
            <div className="mt-5">
              <div className="text-xs font-medium text-neutral-500 mb-2">{t("report.presets")}</div>
              <div className="flex flex-wrap justify-center gap-2">
                {presetList.map((p) => (
                  <button key={p.title} onClick={() => saveWidget(p)} className="rounded-full border border-neutral-200 dark:border-neutral-700 px-3 py-1 text-xs text-neutral-700 dark:text-neutral-300 hover:border-indigo-400 hover:text-indigo-600" data-testid="report-preset">
                    + {p.title}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {widgets.map((w, i) => (
          <div key={w.id} className={cn("rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 flex flex-col", (w.wide || w.type === "pivot") && "md:col-span-2")} data-testid="report-widget">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100 truncate">{w.title || t(`report.type.${w.type}`)}</h3>
              {canEdit && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="ml-auto text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200" aria-label={t("common.more")}>
                      <MoreHorizontal size={15} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setEditing(w)}>
                      <Pencil size={13} /> {t("common.edit")}
                    </DropdownMenuItem>
                    {i > 0 && (
                      <DropdownMenuItem onSelect={() => move(w.id, -1)}>
                        <ArrowUp size={13} /> {t("report.moveUp")}
                      </DropdownMenuItem>
                    )}
                    {i < widgets.length - 1 && (
                      <DropdownMenuItem onSelect={() => move(w.id, 1)}>
                        <ArrowDown size={13} /> {t("report.moveDown")}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => remove(w.id)} className="text-red-600 dark:text-red-400">
                      <Trash2 size={13} /> {t("common.delete")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            <WidgetBody widget={w} fields={fields} records={records} members={members} />
          </div>
        ))}
      </div>

      <WidgetEditor widget={editing} fields={fields} onClose={() => setEditing(null)} onSave={saveWidget} />
    </div>
  );
}

function WidgetBody({ widget, fields, records, members }: { widget: ReportWidget; fields: FieldRow[]; records: RecordRow[]; members: MemberLite[] }) {
  const { t } = useT();
  const block = toBlock(widget);

  if (widget.type === "kpi") {
    const v = computeKpi(records, fields, block);
    return <div className="text-4xl font-bold text-indigo-600 dark:text-indigo-400 py-6 tabular-nums">{formatNumber(v)}</div>;
  }
  if (STACKED.includes(widget.type)) {
    if (!widget.dimension2FieldId || !widget.dimensionFieldId) return <p className="text-xs text-neutral-400 py-6">{t("report.needSplit")}</p>;
    const stacked = computeStackedSeries(records, fields, block, members);
    if (!stacked.rows.length) return <p className="text-xs text-neutral-400 py-6">{t("report.noData")}</p>;
    if (widget.type === "pivot") return <PivotTable rows={stacked.rows} seriesKeys={stacked.seriesKeys} />;
    return (
      <div className="h-72">
        <ChartRenderer type={widget.type} stacked={stacked} />
      </div>
    );
  }
  if (widget.type === "pivot") return null;
  const series = computeSeries(records, fields, block, members);
  if (!series.length || (series.length === 1 && series[0].key === "value" && !widget.dimensionFieldId)) {
    return <div className="text-4xl font-bold text-indigo-600 py-6 tabular-nums">{formatNumber(series[0]?.value ?? 0)}</div>;
  }
  return (
    <div className="h-72">
      <ChartRenderer type={widget.type} series={series} />
    </div>
  );
}

function PivotTable({ rows, seriesKeys }: { rows: Array<Record<string, string | number>>; seriesKeys: { key: string; label: string; color?: string }[] }) {
  const { t } = useT();
  const colTotals = seriesKeys.map((s) => rows.reduce((sum, r) => sum + (Number(r[s.key]) || 0), 0));
  const grand = colTotals.reduce((a, b) => a + b, 0);
  return (
    <div className="overflow-x-auto thin-scroll">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-neutral-50 dark:bg-neutral-800/60">
            <th className="text-left font-medium text-neutral-500 px-2 py-1.5 border border-neutral-200 dark:border-neutral-800"></th>
            {seriesKeys.map((s) => (
              <th key={s.key} className="text-right font-medium px-2 py-1.5 border border-neutral-200 dark:border-neutral-800 whitespace-nowrap" style={{ color: s.color }}>
                {s.label}
              </th>
            ))}
            <th className="text-right font-semibold px-2 py-1.5 border border-neutral-200 dark:border-neutral-800">{t("report.total")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const total = seriesKeys.reduce((sum, s) => sum + (Number(r[s.key]) || 0), 0);
            return (
              <tr key={String(r.__rowKey)} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/40">
                <td className="px-2 py-1.5 border border-neutral-200 dark:border-neutral-800 font-medium text-neutral-700 dark:text-neutral-200 whitespace-nowrap">{String(r.label)}</td>
                {seriesKeys.map((s) => (
                  <td key={s.key} className="text-right tabular-nums px-2 py-1.5 border border-neutral-200 dark:border-neutral-800">
                    {Number(r[s.key]) ? formatNumber(Number(r[s.key])) : <span className="text-neutral-300">·</span>}
                  </td>
                ))}
                <td className="text-right tabular-nums font-semibold px-2 py-1.5 border border-neutral-200 dark:border-neutral-800">{formatNumber(total)}</td>
              </tr>
            );
          })}
          <tr className="bg-neutral-50 dark:bg-neutral-800/60 font-semibold">
            <td className="px-2 py-1.5 border border-neutral-200 dark:border-neutral-800">{t("report.total")}</td>
            {colTotals.map((c, i) => (
              <td key={seriesKeys[i].key} className="text-right tabular-nums px-2 py-1.5 border border-neutral-200 dark:border-neutral-800">
                {formatNumber(c)}
              </td>
            ))}
            <td className="text-right tabular-nums px-2 py-1.5 border border-neutral-200 dark:border-neutral-800">{formatNumber(grand)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function WidgetEditor({ widget, fields, onClose, onSave }: { widget: ReportWidget | null; fields: FieldRow[]; onClose: () => void; onSave: (w: ReportWidget) => void }) {
  const { t } = useT();
  const [draft, setDraft] = useState<ReportWidget | null>(widget);
  const [source, setSource] = useState<ReportWidget | null>(widget);
  if (widget !== source) {
    setSource(widget);
    setDraft(widget);
  }
  if (!draft) return null;
  const patch = (p: Partial<ReportWidget>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const dimensionFields = fields.filter((f) => DIMENSION_TYPES.includes(f.type));
  const numericFields = fields.filter((f) => NUMERIC_TYPES.includes(f.type));
  const dimensionField = fields.find((f) => f.id === draft.dimensionFieldId);
  const needsSplit = STACKED.includes(draft.type);
  const measureValue = !draft.aggregation || draft.aggregation === "count" ? "__count__" : (draft.measureFieldId ?? "");
  const label = "text-xs font-medium text-neutral-500 mb-1 block";

  return (
    <Dialog open={!!widget} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogTitle>{widget?.id ? t("report.editChart") : t("report.addChart")}</DialogTitle>
        <div className="space-y-3">
          <div>
            <label className={label}>{t("report.f.title")}</label>
            <Input value={draft.title} onChange={(e) => patch({ title: e.target.value })} placeholder={t(`report.type.${draft.type}`)} data-testid="report-title" />
          </div>
          <div>
            <label className={label}>{t("report.f.type")}</label>
            <div className="grid grid-cols-5 gap-1">
              {CHART_TYPES.map((ct) => (
                <button key={ct} onClick={() => patch({ type: ct })} className={cn("rounded-md border px-1 py-1.5 text-[11px] leading-tight", draft.type === ct ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300" : "border-neutral-200 dark:border-neutral-800 text-neutral-600 dark:text-neutral-300")} data-testid={`report-type-${ct}`}>
                  {t(`report.type.${ct}`)}
                </button>
              ))}
            </div>
          </div>
          {draft.type !== "kpi" && (
            <div>
              <label className={label}>{t("report.f.groupBy")}</label>
              <Select className="w-full" value={draft.dimensionFieldId ?? ""} onValueChange={(v) => patch({ dimensionFieldId: v || undefined })} options={[{ value: "", label: t("report.f.none") }, ...dimensionFields.map((f) => ({ value: f.id, label: f.name }))]} />
            </div>
          )}
          {dimensionField && DATE_TYPES.includes(dimensionField.type) && (
            <div>
              <label className={label}>{t("report.f.dateBucket")}</label>
              <Select className="w-full" value={draft.dateBucket ?? "day"} onValueChange={(v) => patch({ dateBucket: v as ReportWidget["dateBucket"] })} options={(["day", "week", "month"] as const).map((b) => ({ value: b, label: t(`report.bucket.${b}`) }))} />
            </div>
          )}
          {needsSplit && (
            <div>
              <label className={label}>{t("report.f.splitBy")}</label>
              <Select className="w-full" value={draft.dimension2FieldId ?? ""} onValueChange={(v) => patch({ dimension2FieldId: v || undefined })} options={[{ value: "", label: t("report.f.none") }, ...dimensionFields.filter((f) => f.id !== draft.dimensionFieldId).map((f) => ({ value: f.id, label: f.name }))]} />
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div className={cn(measureValue === "__count__" && "col-span-2")}>
              <label className={label}>{t("report.f.measure")}</label>
              <Select
                className="w-full"
                value={measureValue}
                onValueChange={(v) => (v === "__count__" ? patch({ measureFieldId: undefined, aggregation: "count" }) : patch({ measureFieldId: v, aggregation: draft.aggregation && draft.aggregation !== "count" ? draft.aggregation : "sum" }))}
                options={[{ value: "__count__", label: t("report.measure.count") }, ...numericFields.map((f) => ({ value: f.id, label: f.name }))]}
              />
            </div>
            {measureValue !== "__count__" && (
              <div>
                <label className={label}>{t("report.f.aggregation")}</label>
                <Select className="w-full" value={draft.aggregation ?? "sum"} onValueChange={(v) => patch({ aggregation: v as ReportWidget["aggregation"] })} options={(["sum", "avg", "min", "max"] as const).map((a) => ({ value: a, label: t(`report.agg.${a}`) }))} />
              </div>
            )}
          </div>
          {draft.type !== "kpi" && draft.type !== "pivot" && (
            <div className="grid grid-cols-2 gap-2 items-end">
              <div>
                <label className={label}>{t("report.f.topN")}</label>
                <Select className="w-full" value={String(draft.topN ?? 0)} onValueChange={(v) => patch({ topN: Number(v) || undefined })} options={[{ value: "0", label: t("report.f.all") }, ...[5, 10, 15, 20, 30].map((n) => ({ value: String(n), label: `Top ${n}` }))]} />
              </div>
              <label className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-300 pb-2">
                <input type="checkbox" checked={!!draft.wide} onChange={(e) => patch({ wide: e.target.checked })} /> {t("report.f.wide")}
              </label>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={() => onSave({ ...draft, title: draft.title.trim() })} disabled={draft.type !== "kpi" && !draft.dimensionFieldId} data-testid="report-save">
            {t("common.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

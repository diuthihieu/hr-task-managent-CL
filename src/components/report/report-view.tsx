"use client";
import { useMemo, useState } from "react";
import { nanoid } from "nanoid";
import { Responsive, WidthProvider, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { BarChart3, Plus, MoreHorizontal, Pencil, Trash2, GripVertical } from "lucide-react";
import { ChartRenderer } from "@/components/dashboard/chart-renderer";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/misc";
import { useT } from "@/components/i18n-provider";
import { computeSeries, computeStackedSeries, computeKpi, recordsInSegment, summarizeSegmentTasks, type DashboardBlockConfig, type Segment } from "@/lib/dashboard-engine";
import { SegmentPreview, type SegmentPreviewState } from "@/components/dashboard/segment-preview";
import type { MemberLite, ReportChartType, ReportConfig, ReportWidget } from "@/lib/query-engine";
import type { TFunction } from "@/lib/i18n/core";
import { cn } from "@/lib/utils";
import { AiDashboardActions, AiBuildWidgetsButton } from "@/components/ai/ai-actions";
import type { FieldRow, RecordRow } from "@/types";

const NUMERIC_TYPES = ["number", "currency", "percent", "rating", "progress", "integer"];
const DIMENSION_TYPES = ["status", "single_select", "multi_select", "people", "person", "date", "datetime", "created_time", "modified_time", "created_by", "okr_target", "importance", "urgency", "text", "checkbox"];
const DATE_TYPES = ["date", "datetime", "created_time", "modified_time"];
const STACKED: ReportChartType[] = ["stacked_column", "stacked_bar", "pivot"];
const CHART_TYPES: ReportChartType[] = ["column", "bar", "stacked_column", "stacked_bar", "line", "area", "pie", "donut", "pivot", "kpi"];

const Grid = WidthProvider(Responsive);
const ROW_HEIGHT = 32;
const COLS = { md: 12, xs: 1 };

/** Saved grid positions, falling back to the old two-column flow for widgets never placed. */
function layoutFor(widgets: ReportWidget[]): Layout[] {
  let x = 0;
  let y = 0;
  let rowH = 0;
  const placedBottom = widgets.reduce((m, w) => (w.layout ? Math.max(m, w.layout.y + w.layout.h) : m), 0);
  y = placedBottom;
  return widgets.map((w) => {
    const minH = w.type === "kpi" ? 3 : 5;
    if (w.layout) return { i: w.id, ...w.layout, minW: 2, minH };
    const width = w.wide || w.type === "pivot" ? 12 : 6;
    const h = w.type === "kpi" ? 5 : 10;
    if (x + width > 12) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    const l = { i: w.id, x, y, w: width, h, minW: 2, minH };
    x += width;
    rowH = Math.max(rowH, h);
    return l;
  });
}

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
/** Text snapshot of every report widget's numbers, for AI Insight. */
function reportSnapshot(widgets: ReportWidget[], fields: FieldRow[], records: RecordRow[], members: MemberLite[]): string {
  const lines = [`Tasks in view: ${records.length}`];
  for (const w of widgets) {
    const block = toBlock(w);
    lines.push(`\n## ${w.title || w.type} (${w.type})`);
    if (w.type === "kpi") lines.push(`Value: ${computeKpi(records, fields, block)}`);
    else if (STACKED.includes(w.type)) {
      if (!w.dimensionFieldId || !w.dimension2FieldId) continue;
      const st = computeStackedSeries(records, fields, block, members);
      lines.push(st.rows.slice(0, 40).map((r) => Object.entries(r).map(([k, v]) => `${k}=${v}`).join(", ")).join("\n"));
    } else lines.push(computeSeries(records, fields, block, members).slice(0, 60).map((p) => `${p.label}: ${p.value}`).join("\n"));
  }
  return lines.join("\n");
}

export function ReportView({
  projectId,
  fields,
  records,
  members,
  config,
  canEdit,
  onConfigChange,
  onOpenRecord,
}: {
  /** Opens a task from the drill-down preview. */
  onOpenRecord?: (recordId: string) => void;
  projectId: string;
  fields: FieldRow[];
  records: RecordRow[];
  members: MemberLite[];
  config: ReportConfig;
  canEdit: boolean;
  onConfigChange: (next: ReportConfig) => void;
}) {
  const { t } = useT();
  const widgets = useMemo(() => config.widgets ?? [], [config.widgets]);
  const [editing, setEditing] = useState<ReportWidget | null>(null);

  function saveWidget(input: ReportWidget) {
    const old = widgets.find((x) => x.id === input.id);
    // Toggling "full width" in the editor re-sizes a card that was already placed on the grid.
    const w = old?.layout && !!old.wide !== !!input.wide ? { ...input, layout: { ...old.layout, x: input.wide ? 0 : old.layout.x, w: input.wide ? 12 : 6 } } : input;
    const next = w.id && widgets.some((x) => x.id === w.id) ? widgets.map((x) => (x.id === w.id ? w : x)) : [...widgets, { ...w, id: w.id || nanoid(8) }];
    onConfigChange({ ...config, widgets: next });
    setEditing(null);
  }
  function remove(id: string) {
    onConfigChange({ ...config, widgets: widgets.filter((w) => w.id !== id) });
  }
  const layout = useMemo(() => layoutFor(widgets), [widgets]);
  const [preview, setPreview] = useState<SegmentPreviewState | null>(null);

  function saveLayout(next: Layout[]) {
    const pos = new Map(next.map((l) => [l.i, { x: l.x, y: l.y, w: l.w, h: l.h }]));
    const changed = widgets.some((w) => {
      const p = pos.get(w.id);
      return p && (!w.layout || p.x !== w.layout.x || p.y !== w.layout.y || p.w !== w.layout.w || p.h !== w.layout.h);
    });
    if (changed) onConfigChange({ ...config, widgets: widgets.map((w) => (pos.has(w.id) ? { ...w, layout: pos.get(w.id) } : w)) });
  }

  function openSegment(w: ReportWidget, segment: Segment) {
    const matched = recordsInSegment(records, fields, toBlock(w), segment);
    setPreview({ widgetTitle: w.title || t(`report.type.${w.type}`), segment, tasks: summarizeSegmentTasks(matched, fields, members), total: matched.length });
  }

  const presetList = useMemo(() => presets(fields, t), [fields, t]);

  return (
    <div className="flex-1 overflow-y-auto thin-scroll p-4">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-xs text-neutral-500">{t("report.basedOn", { count: records.length })}</span>
        <div className="ml-auto" />
        {widgets.length > 0 && <AiDashboardActions projectId={projectId} getData={() => reportSnapshot(widgets, fields, records, members)} />}
        {canEdit && (
          <AiBuildWidgetsButton
            target="report"
            projectId={projectId}
            onBuilt={(ws) => onConfigChange({ ...config, widgets: [...widgets, ...(ws as unknown as ReportWidget[])] })}
          />
        )}
        {canEdit && (
          <Button size="sm" onClick={() => setEditing({ id: "", title: "", type: "column", aggregation: "count" })} data-testid="report-add-chart">
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

      {widgets.length > 0 && <p className="text-[11px] text-neutral-400 mb-1">{canEdit ? t("seg.hint") : t("seg.hintView")}</p>}
      <Grid
        className="layout woli-grid -mx-2.5"
        layouts={{ md: layout, xs: [...layout].sort((a, b) => a.y - b.y || a.x - b.x).map((l, i) => ({ ...l, x: 0, y: i * 10, w: 1 })) }}
        breakpoints={{ md: 768, xs: 0 }}
        cols={COLS}
        rowHeight={ROW_HEIGHT}
        margin={[12, 12]}
        draggableHandle=".report-drag"
        isDraggable={canEdit}
        isResizable={canEdit}
        resizeHandles={["se", "e", "s"]}
        onDragStop={(l) => saveLayout(l)}
        onResizeStop={(l) => saveLayout(l)}
      >
        {widgets.map((w) => (
          <div key={w.id} className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 flex flex-col overflow-hidden" data-testid="report-widget">
            <div className={cn("flex items-center gap-1.5 px-4 pt-3 pb-2 shrink-0", canEdit && "report-drag cursor-grab active:cursor-grabbing")}>
              {canEdit && <GripVertical size={13} className="text-neutral-300 shrink-0 -ml-1.5" />}
              <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100 truncate flex-1">{w.title || t(`report.type.${w.type}`)}</h3>
              {canEdit && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200" aria-label={t("common.more")} onMouseDown={(e) => e.stopPropagation()}>
                      <MoreHorizontal size={15} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setEditing(w)}>
                      <Pencil size={13} /> {t("common.edit")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => remove(w.id)} className="text-red-600 dark:text-red-400">
                      <Trash2 size={13} /> {t("common.delete")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            <div className="flex-1 min-h-0 px-4 pb-3 flex flex-col">
              <WidgetBody widget={w} fields={fields} records={records} members={members} onSegment={(seg) => openSegment(w, seg)} />
            </div>
          </div>
        ))}
      </Grid>

      <SegmentPreview state={preview} onClose={() => setPreview(null)} onOpenTask={onOpenRecord ? (task) => { setPreview(null); onOpenRecord(task.id); } : undefined} />

      <WidgetEditor widget={editing} fields={fields} onClose={() => setEditing(null)} onSave={saveWidget} />
    </div>
  );
}

function WidgetBody({ widget, fields, records, members, onSegment }: { widget: ReportWidget; fields: FieldRow[]; records: RecordRow[]; members: MemberLite[]; onSegment: (segment: Segment) => void }) {
  const { t } = useT();
  const block = toBlock(widget);

  if (widget.type === "kpi") {
    const v = computeKpi(records, fields, block);
    return (
      <button type="button" onClick={() => onSegment({ key: "value", label: widget.title || t("report.type.kpi") })} className="flex-1 flex items-center text-left text-4xl font-bold text-indigo-600 dark:text-indigo-400 tabular-nums hover:opacity-80" data-testid="report-kpi">
        {formatNumber(v)}
      </button>
    );
  }
  if (STACKED.includes(widget.type)) {
    if (!widget.dimension2FieldId || !widget.dimensionFieldId) return <p className="text-xs text-neutral-400 py-6">{t("report.needSplit")}</p>;
    const stacked = computeStackedSeries(records, fields, block, members);
    if (!stacked.rows.length) return <p className="text-xs text-neutral-400 py-6">{t("report.noData")}</p>;
    if (widget.type === "pivot") return <PivotTable rows={stacked.rows} seriesKeys={stacked.seriesKeys} onCell={onSegment} />;
    return (
      <div className="flex-1 min-h-0">
        <ChartRenderer type={widget.type} stacked={stacked} onSegmentClick={onSegment} />
      </div>
    );
  }
  if (widget.type === "pivot") return null;
  const series = computeSeries(records, fields, block, members);
  if (!series.length || (series.length === 1 && series[0].key === "value" && !widget.dimensionFieldId)) {
    return <div className="text-4xl font-bold text-indigo-600 py-6 tabular-nums">{formatNumber(series[0]?.value ?? 0)}</div>;
  }
  return (
    <div className="flex-1 min-h-0">
      <ChartRenderer type={widget.type} series={series} onSegmentClick={onSegment} />
    </div>
  );
}

function PivotTable({ rows, seriesKeys, onCell }: { rows: Array<Record<string, string | number>>; seriesKeys: { key: string; label: string; color?: string }[]; onCell: (segment: Segment) => void }) {
  const { t } = useT();
  const colTotals = seriesKeys.map((s) => rows.reduce((sum, r) => sum + (Number(r[s.key]) || 0), 0));
  const grand = colTotals.reduce((a, b) => a + b, 0);
  return (
    <div className="flex-1 min-h-0 overflow-auto thin-scroll">
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
                <td className="px-2 py-1.5 border border-neutral-200 dark:border-neutral-800 font-medium text-neutral-700 dark:text-neutral-200 whitespace-nowrap">
                  <button type="button" className="hover:text-indigo-600 hover:underline" onClick={() => onCell({ key: String(r.__rowKey), label: String(r.label) })}>
                    {String(r.label)}
                  </button>
                </td>
                {seriesKeys.map((s) => (
                  <td key={s.key} className="text-right tabular-nums px-2 py-1.5 border border-neutral-200 dark:border-neutral-800">
                    {Number(r[s.key]) ? (
                      <button type="button" className="hover:text-indigo-600 hover:underline tabular-nums" onClick={() => onCell({ key: String(r.__rowKey), label: String(r.label), seriesKey: s.key, seriesLabel: s.label })} data-testid="pivot-cell">
                        {formatNumber(Number(r[s.key]))}
                      </button>
                    ) : (
                      <span className="text-neutral-300">–</span>
                    )}
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

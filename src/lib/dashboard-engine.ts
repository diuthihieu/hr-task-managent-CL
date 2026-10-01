// Aggregation engine for dashboard widgets. Deliberately separate from
// query-engine.ts's grid-oriented filter/sort/group (which operates on one
// table's already-fetched records) - this module additionally knows how to
// turn a group of records into chart-ready {label, value} series, bucket
// dates, and combine dashboard + chart + slicer filters into one FilterGroup.
// It never stores or duplicates record data: every call re-reads the current
// records for the widget's table, so a widget always reflects live Base data.

import type { FieldRow, RecordRow } from "@/types";
import { applyFilters, getCellValue, resolveValueLabel, type FilterGroup, type FilterCondition, type MemberLite } from "./query-engine";
import { parseFieldConfig } from "./field-types";

export type Aggregation = "count" | "distinct" | "sum" | "avg" | "min" | "max";
export type DateBucket = "day" | "week" | "month";

export interface WidgetStyleConfig {
  palette?: string[];
  backgroundColor?: string;
  textColor?: string;
  borderColor?: string;
  gridColor?: string;
  fontFamily?: "system" | "inter" | "georgia" | "mono";
  fontSize?: number;
  titleSize?: number;
  titleAlign?: "left" | "center" | "right";
  titleWeight?: "normal" | "medium" | "bold";
  borderWidth?: number;
  borderRadius?: number;
  shadow?: "none" | "small" | "medium" | "large";
  showLegend?: boolean;
  showGrid?: boolean;
  showDataLabels?: boolean;
  lineWidth?: number;
  barRadius?: number;
  donutInnerRadius?: number;
}

export interface DashboardBlockConfig {
  dataSource?: { projectId?: string; viewId?: string };
  dimensionFieldId?: string;
  dimension2FieldId?: string; // combo chart's line series, or funnel/treemap secondary
  measureFieldId?: string;
  measure2FieldId?: string; // combo chart's second series
  aggregation?: Aggregation;
  dateBucket?: DateBucket;
  filters?: FilterGroup; // chart-level filters, ANDed with dashboard-level filters
  sortDesc?: boolean;
  topN?: number;
  tableFieldIds?: string[]; // Table block: which fields to show
  gaugeMax?: number; // Gauge block target/max
  kpiCompareTo?: "none" | "previous_week" | "previous_month" | "previous_quarter" | "previous_year";
  /** Date field used to place records into the current and previous KPI periods. */
  kpiDateFieldId?: string;
  /** Link field and label field used by the interactive relationship graph. */
  networkLinkFieldId?: string;
  networkLabelFieldId?: string;
  style?: WidgetStyleConfig;
}

export interface SeriesPoint {
  key: string;
  label: string;
  color?: string;
  value: number;
  value2?: number;
}

const DATE_TYPES = ["date", "datetime", "created_time", "modified_time"];

function bucketDate(iso: string, bucket: DateBucket): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "__empty__";
  if (bucket === "day") return d.toISOString().slice(0, 10);
  if (bucket === "month") return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  // week: Monday-start ISO week bucket, labeled by that Monday's date
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  return monday.toISOString().slice(0, 10);
}

// `recordCount` drives "count" independently of `values` - `values` is only
// populated when a measure field is chosen, but Count (the default
// aggregation, used whenever the user leaves Measure as "Record count")
// must still equal the number of records in the group even then.
function aggregate(values: number[], distinctValues: unknown[], fn: Aggregation, recordCount: number): number {
  if (fn === "count") return recordCount;
  if (fn === "distinct") return new Set(distinctValues.map((v) => JSON.stringify(v))).size;
  if (!values.length) return 0;
  if (fn === "sum") return values.reduce((a, b) => a + b, 0);
  if (fn === "avg") return values.reduce((a, b) => a + b, 0) / values.length;
  if (fn === "min") return Math.min(...values);
  if (fn === "max") return Math.max(...values);
  return 0;
}

/** Merge dashboard-level, chart-level and slicer filter groups into one AND group. */
export function mergeFilters(...groups: (FilterGroup | undefined)[]): FilterGroup {
  const conditions = groups.flatMap((g) => g?.conditions ?? []);
  return { conjunction: "AND", conditions };
}

export interface CrossFilter {
  fieldName: string;
  label: string;
  /** Date-range slicers bypass label matching and filter directly (before/after/between). */
  operator?: "is" | "before" | "after" | "between";
  value2?: string;
}

// Cross-chart click filtering AND persisted dashboard slicers share this one
// mechanism ("where practical" - the spec doesn't ask for a full formal
// relationship model between tables). Both filter every widget that happens
// to have a field with the *same name*, by matching that field's
// option/label text - clicking a bar/pie segment just derives a CrossFilter
// from the point clicked instead of the user typing one into a slicer. This
// works well for the common case (multiple tables all having a "Status" or
// "Category" field) without requiring the user to define cross-table joins
// just to get interactive dashboards.
export function resolveCrossFilterCondition(
  fields: FieldRow[],
  members: MemberLite[],
  crossFilter: CrossFilter | undefined
): FilterCondition | null {
  if (!crossFilter) return null;
  const field = fields.find((f) => f.name.toLowerCase() === crossFilter.fieldName.toLowerCase());
  if (!field) return null;

  if (crossFilter.operator === "before" || crossFilter.operator === "after") {
    return { id: "__crossfilter__", fieldId: field.id, operator: crossFilter.operator, value: crossFilter.label };
  }
  if (crossFilter.operator === "between") {
    return { id: "__crossfilter__", fieldId: field.id, operator: "between", value: crossFilter.label, value2: crossFilter.value2 };
  }

  const cfg = parseFieldConfig(field.config);
  if (cfg.options?.length) {
    const option = cfg.options.find((o) => o.label.toLowerCase() === crossFilter.label.toLowerCase());
    if (!option) return null;
    return { id: "__crossfilter__", fieldId: field.id, operator: "is", value: option.id };
  }
  if (["person", "people"].includes(field.type)) {
    const member = members.find((m) => m.name.toLowerCase() === crossFilter.label.toLowerCase());
    if (!member) return null;
    return { id: "__crossfilter__", fieldId: field.id, operator: "is", value: member.id };
  }
  return { id: "__crossfilter__", fieldId: field.id, operator: "equals", value: crossFilter.label };
}

export function resolveCrossFilterConditions(fields: FieldRow[], members: MemberLite[], filters: CrossFilter[] | undefined): FilterCondition[] {
  if (!filters?.length) return [];
  return filters.map((f) => resolveCrossFilterCondition(fields, members, f)).filter((c): c is FilterCondition => c !== null);
}

export function computeSeries(
  records: RecordRow[],
  fields: FieldRow[],
  config: DashboardBlockConfig,
  members: MemberLite[],
  currentUserId?: string
): SeriesPoint[] {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const dimensionField = config.dimensionFieldId ? byId.get(config.dimensionFieldId) : undefined;
  const measureField = config.measureFieldId ? byId.get(config.measureFieldId) : undefined;
  const measure2Field = config.measure2FieldId ? byId.get(config.measure2FieldId) : undefined;
  const aggFn = config.aggregation ?? "count";

  const filtered = applyFilters(records, fields, config.filters, currentUserId);
  if (!dimensionField) {
    const values = measureField ? filtered.map((r) => Number(getCellValue(r, measureField, fields)) || 0) : [];
    const distinct = measureField ? filtered.map((r) => getCellValue(r, measureField, fields)) : filtered.map((r) => r.id);
    return [{ key: "value", label: "Value", value: aggregate(values, distinct, aggFn, filtered.length) }];
  }

  const isDate = DATE_TYPES.includes(dimensionField.type);
  const bucket = config.dateBucket ?? "day";
  const groups = new Map<string, RecordRow[]>();
  for (const record of filtered) {
    const raw = getCellValue(record, dimensionField, fields);
    const rawKeys = Array.isArray(raw) ? (raw.length ? raw : ["__empty__"]) : [raw ?? "__empty__"];
    for (const rawKey of rawKeys) {
      const key = isDate && rawKey !== "__empty__" ? bucketDate(String(rawKey), bucket) : String(rawKey);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(record);
    }
  }

  let points: SeriesPoint[] = [];
  for (const [key, recs] of groups) {
    const values = measureField ? recs.map((r) => Number(getCellValue(r, measureField, fields)) || 0) : [];
    const distinct = measureField ? recs.map((r) => getCellValue(r, measureField, fields)) : recs.map((r) => r.id);
    const value = aggregate(values, distinct, aggFn, recs.length);
    const value2 = measure2Field
      ? aggregate(
          recs.map((r) => Number(getCellValue(r, measure2Field, fields)) || 0),
          recs.map((r) => getCellValue(r, measure2Field, fields)),
          aggFn,
          recs.length
        )
      : undefined;
    const { label, color } = isDate ? { label: key, color: undefined } : resolveValueLabel(dimensionField, key, members);
    points.push({ key, label, color, value, value2 });
  }

  points.sort((a, b) => (isDate ? a.key.localeCompare(b.key) : b.value - a.value));
  if (!isDate && config.sortDesc === false) points = points.slice().sort((a, b) => a.value - b.value);
  if (config.topN && config.topN > 0 && points.length > config.topN) points = points.slice(0, config.topN);
  return points;
}

export interface StackedSeries {
  rows: Array<Record<string, string | number>>;
  seriesKeys: { key: string; label: string; color?: string }[];
}

/** Row (dimensionField) x column (dimension2FieldId) pivot for stacked bar/column charts. */
export function computeStackedSeries(
  records: RecordRow[],
  fields: FieldRow[],
  config: DashboardBlockConfig,
  members: MemberLite[],
  currentUserId?: string
): StackedSeries {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const dimensionField = config.dimensionFieldId ? byId.get(config.dimensionFieldId) : undefined;
  const seriesField = config.dimension2FieldId ? byId.get(config.dimension2FieldId) : undefined;
  const measureField = config.measureFieldId ? byId.get(config.measureFieldId) : undefined;
  const aggFn = config.aggregation ?? "count";
  if (!dimensionField || !seriesField) return { rows: [], seriesKeys: [] };

  const filtered = applyFilters(records, fields, config.filters, currentUserId);
  const cells = new Map<string, RecordRow[]>(); // `${rowKey}::${seriesKey}`
  const rowKeys = new Map<string, string>(); // rowKey -> label
  const seriesKeysMap = new Map<string, { label: string; color?: string }>();

  for (const record of filtered) {
    const rowRaw = getCellValue(record, dimensionField, fields);
    const seriesRaw = getCellValue(record, seriesField, fields);
    const rowVals = Array.isArray(rowRaw) ? (rowRaw.length ? rowRaw : ["__empty__"]) : [rowRaw ?? "__empty__"];
    const seriesVals = Array.isArray(seriesRaw) ? (seriesRaw.length ? seriesRaw : ["__empty__"]) : [seriesRaw ?? "__empty__"];
    for (const rv of rowVals) {
      const rowKey = String(rv);
      if (!rowKeys.has(rowKey)) rowKeys.set(rowKey, resolveValueLabel(dimensionField, rowKey, members).label);
      for (const sv of seriesVals) {
        const seriesKey = String(sv);
        if (!seriesKeysMap.has(seriesKey)) seriesKeysMap.set(seriesKey, resolveValueLabel(seriesField, seriesKey, members));
        const cellKey = `${rowKey}::${seriesKey}`;
        if (!cells.has(cellKey)) cells.set(cellKey, []);
        cells.get(cellKey)!.push(record);
      }
    }
  }

  const seriesKeys = [...seriesKeysMap.entries()].map(([key, v]) => ({ key, label: v.label, color: v.color }));
  const rows = [...rowKeys.entries()].map(([rowKey, rowLabel]) => {
    const row: Record<string, string | number> = { __rowKey: rowKey, label: rowLabel };
    for (const { key: seriesKey } of seriesKeys) {
      const recs = cells.get(`${rowKey}::${seriesKey}`) ?? [];
      const values = measureField ? recs.map((r) => Number(getCellValue(r, measureField, fields)) || 0) : [];
      const distinct = measureField ? recs.map((r) => getCellValue(r, measureField, fields)) : recs.map((r) => r.id);
      row[seriesKey] = aggregate(values, distinct, aggFn, recs.length);
    }
    return row;
  });
  return { rows, seriesKeys };
}

export interface ScatterPoint {
  x: number;
  y: number;
  label: string;
}

/** Raw per-record x/y pairs for a scatter plot - not aggregated by dimension. */
export function computeScatterPoints(
  records: RecordRow[],
  fields: FieldRow[],
  config: DashboardBlockConfig,
  currentUserId?: string
): ScatterPoint[] {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const xField = config.measure2FieldId ? byId.get(config.measure2FieldId) : undefined;
  const yField = config.measureFieldId ? byId.get(config.measureFieldId) : undefined;
  const labelField = config.dimensionFieldId ? byId.get(config.dimensionFieldId) : undefined;
  if (!xField || !yField) return [];
  const filtered = applyFilters(records, fields, config.filters, currentUserId);
  return filtered.slice(0, 500).map((r) => ({
    x: Number(getCellValue(r, xField, fields)) || 0,
    y: Number(getCellValue(r, yField, fields)) || 0,
    label: labelField ? String(getCellValue(r, labelField, fields) ?? "") : "",
  }));
}

export function computeKpi(
  records: RecordRow[],
  fields: FieldRow[],
  config: DashboardBlockConfig,
  currentUserId?: string
): number {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const measureField = config.measureFieldId ? byId.get(config.measureFieldId) : undefined;
  const filtered = applyFilters(records, fields, config.filters, currentUserId);
  const values = measureField ? filtered.map((r) => Number(getCellValue(r, measureField, fields)) || 0) : [];
  const distinct = measureField ? filtered.map((r) => getCellValue(r, measureField, fields)) : filtered.map((r) => r.id);
  return aggregate(values, distinct, config.aggregation ?? "count", filtered.length);
}

export interface NetworkGraphNode {
  id: string;
  label: string;
}

export interface NetworkGraphEdge {
  source: string;
  target: string;
}

export interface NetworkGraphData {
  nodes: NetworkGraphNode[];
  edges: NetworkGraphEdge[];
}

/** Build a permission-filtered graph from the records already loaded for a
 * dashboard widget. Targets outside the filtered result are never exposed. */
export function computeNetworkGraph(records: RecordRow[], fields: FieldRow[], config: DashboardBlockConfig, currentUserId?: string): NetworkGraphData {
  const linkField = config.networkLinkFieldId ? fields.find((field) => field.id === config.networkLinkFieldId && field.type === "link") : undefined;
  if (!linkField) return { nodes: [], edges: [] };
  const labelField = config.networkLabelFieldId
    ? fields.find((field) => field.id === config.networkLabelFieldId)
    : fields.find((field) => field.id === "sys_title");
  // Keep the graph readable and bound the amount of relationship metadata
  // returned to the browser. Large tables should be narrowed with a view or
  // dashboard filter before visualization.
  const filtered = applyFilters(records, fields, config.filters, currentUserId).slice(0, 70);
  const visibleIds = new Set(filtered.map((record) => record.id));
  const nodes = filtered.map((record) => ({
    id: record.id,
    label: String(labelField ? getCellValue(record, labelField, fields) ?? "" : record.id),
  }));
  const seen = new Set<string>();
  const edges: NetworkGraphEdge[] = [];
  for (const record of filtered) {
    const raw = getCellValue(record, linkField, fields);
    const targets = Array.isArray(raw) ? raw.map(String) : raw ? [String(raw)] : [];
    for (const target of targets) {
      if (!visibleIds.has(target) || target === record.id) continue;
      const key = [record.id, target].sort().join(":");
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source: record.id, target });
    }
  }
  return { nodes, edges };
}

export interface KpiTrend {
  current: number;
  previous: number;
  delta: number;
  percentChange: number | null;
  direction: "up" | "down" | "flat";
  period: Exclude<NonNullable<DashboardBlockConfig["kpiCompareTo"]>, "none">;
}

function utcPeriodStart(now: Date, period: KpiTrend["period"]): Date {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (period === "previous_week") {
    const day = start.getUTCDay();
    start.setUTCDate(start.getUTCDate() - (day === 0 ? 6 : day - 1));
  } else if (period === "previous_month") {
    start.setUTCDate(1);
  } else if (period === "previous_quarter") {
    start.setUTCMonth(Math.floor(start.getUTCMonth() / 3) * 3, 1);
  } else {
    start.setUTCMonth(0, 1);
  }
  return start;
}

function shiftUtcPeriod(date: Date, period: KpiTrend["period"], amount: number): Date {
  const shifted = new Date(date);
  if (period === "previous_week") shifted.setUTCDate(shifted.getUTCDate() + amount * 7);
  else if (period === "previous_month") shifted.setUTCMonth(shifted.getUTCMonth() + amount);
  else if (period === "previous_quarter") shifted.setUTCMonth(shifted.getUTCMonth() + amount * 3);
  else shifted.setUTCFullYear(shifted.getUTCFullYear() + amount);
  return shifted;
}

/** Compute the KPI for the current calendar period and the immediately preceding one. */
export function computeKpiTrend(
  records: RecordRow[],
  fields: FieldRow[],
  config: DashboardBlockConfig,
  currentUserId?: string,
  now = new Date()
): KpiTrend | null {
  const period = config.kpiCompareTo;
  if (!period || period === "none" || !config.kpiDateFieldId) return null;
  const dateField = fields.find((field) => field.id === config.kpiDateFieldId && DATE_TYPES.includes(field.type));
  if (!dateField) return null;

  // The selected comparison field defines the period. A saved date filter on
  // that same field must not make the current/previous windows asymmetric.
  const filters = config.filters
    ? { ...config.filters, conditions: config.filters.conditions.filter((condition) => condition.fieldId !== dateField.id) }
    : undefined;
  const base = applyFilters(records, fields, filters, currentUserId);
  const currentStart = utcPeriodStart(now, period);
  const currentEnd = shiftUtcPeriod(currentStart, period, 1);
  const previousStart = shiftUtcPeriod(currentStart, period, -1);
  const inRange = (record: RecordRow, start: Date, end: Date) => {
    const value = getCellValue(record, dateField, fields);
    const time = value ? new Date(String(value)).getTime() : Number.NaN;
    return Number.isFinite(time) && time >= start.getTime() && time < end.getTime();
  };
  const withoutFilters = { ...config, filters: undefined };
  const current = computeKpi(base.filter((record) => inRange(record, currentStart, currentEnd)), fields, withoutFilters, currentUserId);
  const previous = computeKpi(base.filter((record) => inRange(record, previousStart, currentStart)), fields, withoutFilters, currentUserId);
  const delta = current - previous;
  return {
    current,
    previous,
    delta,
    percentChange: previous === 0 ? (current === 0 ? 0 : null) : (delta / Math.abs(previous)) * 100,
    direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
    period,
  };
}

export const AGGREGATION_LABELS: Record<Aggregation, string> = {
  count: "Count",
  distinct: "Distinct Count",
  sum: "Sum",
  avg: "Average",
  min: "Min",
  max: "Max",
};

export const CHART_TYPES = [
  { type: "kpi", label: "KPI Card" },
  { type: "table", label: "Table" },
  { type: "bar", label: "Bar Chart" },
  { type: "column", label: "Column Chart" },
  { type: "stacked_column", label: "Stacked Column" },
  { type: "stacked_bar", label: "Stacked Bar" },
  { type: "line", label: "Line Chart" },
  { type: "area", label: "Area Chart" },
  { type: "pie", label: "Pie Chart" },
  { type: "donut", label: "Donut Chart" },
  { type: "combo", label: "Combo Chart" },
  { type: "scatter", label: "Scatter Plot" },
  { type: "network", label: "Relationship Graph" },
  { type: "radar", label: "Radar Chart" },
  { type: "treemap", label: "Treemap" },
  { type: "funnel", label: "Funnel" },
  { type: "gauge", label: "Gauge" },
] as const;

export type ChartType = (typeof CHART_TYPES)[number]["type"];

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const clampStyleNumber = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;

/** Dashboard configuration is editable JSON (and can be AI-generated), so
 * only allow bounded style primitives before sending values into CSS/SVG. */
export function normalizeWidgetStyle(raw: unknown): WidgetStyleConfig | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  const color = (key: string) => typeof value[key] === "string" && HEX_COLOR.test(value[key]) ? value[key] as string : undefined;
  const enumValue = <T extends string>(key: string, values: readonly T[], fallback: T): T =>
    typeof value[key] === "string" && values.includes(value[key] as T) ? value[key] as T : fallback;
  return {
    palette: Array.isArray(value.palette) ? value.palette.filter((item): item is string => typeof item === "string" && HEX_COLOR.test(item)).slice(0, 10) : undefined,
    backgroundColor: color("backgroundColor"),
    textColor: color("textColor"),
    borderColor: color("borderColor"),
    gridColor: color("gridColor"),
    fontFamily: enumValue("fontFamily", ["system", "inter", "georgia", "mono"] as const, "system"),
    fontSize: clampStyleNumber(value.fontSize, 9, 20, 11),
    titleSize: clampStyleNumber(value.titleSize, 10, 28, 12),
    titleAlign: enumValue("titleAlign", ["left", "center", "right"] as const, "left"),
    titleWeight: enumValue("titleWeight", ["normal", "medium", "bold"] as const, "medium"),
    borderWidth: clampStyleNumber(value.borderWidth, 0, 6, 1),
    borderRadius: clampStyleNumber(value.borderRadius, 0, 32, 8),
    shadow: enumValue("shadow", ["none", "small", "medium", "large"] as const, "none"),
    showLegend: typeof value.showLegend === "boolean" ? value.showLegend : true,
    showGrid: typeof value.showGrid === "boolean" ? value.showGrid : true,
    showDataLabels: typeof value.showDataLabels === "boolean" ? value.showDataLabels : false,
    lineWidth: clampStyleNumber(value.lineWidth, 1, 8, 2),
    barRadius: clampStyleNumber(value.barRadius, 0, 24, 4),
    donutInnerRadius: clampStyleNumber(value.donutInnerRadius, 20, 80, 55),
  };
}

export function parseBlockConfig(raw: string | null | undefined): DashboardBlockConfig {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as DashboardBlockConfig;
    return { ...parsed, style: normalizeWidgetStyle(parsed.style) };
  } catch {
    return {};
  }
}

// ---- Drill-down: the tasks behind one chart segment ------------------------

/** One clicked segment: the group key (and, on stacked charts / pivots, the stack key). */
export interface Segment {
  key: string;
  label: string;
  seriesKey?: string;
  seriesLabel?: string;
}

function groupKeysOf(record: RecordRow, field: FieldRow, fields: FieldRow[], bucket: DateBucket): string[] {
  const raw = getCellValue(record, field, fields);
  const rawKeys = Array.isArray(raw) ? (raw.length ? raw : ["__empty__"]) : [raw ?? "__empty__"];
  const isDate = DATE_TYPES.includes(field.type);
  return rawKeys.map((k) => (isDate && k !== "__empty__" ? bucketDate(String(k), bucket) : String(k)));
}

/**
 * The records a segment aggregates, grouped exactly like computeSeries /
 * computeStackedSeries (same filters, date buckets and multi-value fan-out),
 * so the preview always adds up to what the chart shows.
 */
export function recordsInSegment(records: RecordRow[], fields: FieldRow[], config: DashboardBlockConfig, segment: Segment, currentUserId?: string): RecordRow[] {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const dim = config.dimensionFieldId ? byId.get(config.dimensionFieldId) : undefined;
  const dim2 = config.dimension2FieldId ? byId.get(config.dimension2FieldId) : undefined;
  const bucket = config.dateBucket ?? "day";
  const filtered = applyFilters(records, fields, config.filters, currentUserId);
  if (!dim) return filtered;
  return filtered.filter((r) => {
    if (!groupKeysOf(r, dim, fields, bucket).includes(segment.key)) return false;
    if (segment.seriesKey !== undefined && dim2) return groupKeysOf(r, dim2, fields, bucket).includes(segment.seriesKey);
    return true;
  });
}

/** Compact task row for the segment preview (never the full record). */
export interface SegmentTask {
  id: string;
  projectId: string;
  title: string;
  status: { label: string; color?: string; category?: string } | null;
  priority: { label: string; color?: string } | null;
  assignees: string[];
  dueDate: string | null;
  progress: number | null;
}

export function summarizeSegmentTasks(records: RecordRow[], fields: FieldRow[], members: MemberLite[]): SegmentTask[] {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const title = fields.find((f) => f.isPrimary) ?? byId.get("sys_title");
  const status = byId.get("sys_status");
  const priority = byId.get("sys_priority");
  const assignees = byId.get("sys_assignees");
  const due = byId.get("sys_due_date");
  const progress = byId.get("sys_progress");
  const statusOptions = status ? ((parseFieldConfig(status.config).options ?? []) as { id: string; label: string; color?: string; category?: string }[]) : [];
  return records.map((r) => {
    const statusId = status ? getCellValue(r, status, fields) : null;
    const opt = statusOptions.find((o) => o.id === statusId);
    const pr = priority ? getCellValue(r, priority, fields) : null;
    const people = assignees ? getCellValue(r, assignees, fields) : null;
    const dueRaw = due ? getCellValue(r, due, fields) : null;
    const prog = progress ? getCellValue(r, progress, fields) : null;
    return {
      id: r.id,
      projectId: r.projectId,
      title: title ? String(getCellValue(r, title, fields) ?? "") : "",
      status: opt ? { label: opt.label, color: opt.color, category: opt.category } : null,
      priority: priority && pr ? resolveValueLabel(priority, String(pr), members) : null,
      assignees: Array.isArray(people) ? people.map((id) => members.find((m) => m.id === id)?.name).filter((n): n is string => !!n) : [],
      dueDate: dueRaw ? String(dueRaw).slice(0, 10) : null,
      progress: typeof prog === "number" ? prog : prog != null && prog !== "" && !Number.isNaN(Number(prog)) ? Number(prog) : null,
    };
  });
}

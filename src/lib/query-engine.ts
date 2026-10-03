// Generic filter / sort / group / conditional-formatting engine shared by
// every view type. Operates in the application layer over already-fetched
// rows (Grid records for one table) rather than pushing down to SQL - a
// deliberate v1 simplification given expected per-table row counts; see
// README.md "Known simplifications".

import type { FieldRow, RecordRow } from "@/types";
import { evaluateFormula } from "./formula";
import { parseFieldConfig, resolveOkrTarget } from "./field-types";
import { SYSTEM_FIELD_NAMES_EN } from "./system-field-names";

export type FilterOperator =
  | "contains"
  | "not_contains"
  | "equals"
  | "not_equals"
  | "is_empty"
  | "is_not_empty"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "between"
  | "before"
  | "after"
  | "today"
  | "yesterday"
  | "this_week"
  | "this_month"
  | "is"
  | "is_not"
  | "contains_any"
  | "contains_all"
  | "is_current_user";

export interface FilterCondition {
  id: string;
  fieldId: string;
  operator: FilterOperator;
  value?: unknown;
  value2?: unknown; // for "between"
}

export interface FilterGroup {
  conjunction: "AND" | "OR";
  conditions: FilterCondition[];
}

export interface SortRule {
  fieldId: string;
  direction: "asc" | "desc";
}

export interface GroupRule {
  fieldId: string | null;
  aggFieldId?: string | null;
  aggFn?: "count" | "sum" | "avg" | "min" | "max";
}

export interface ConditionalFormatRule {
  id: string;
  fieldId: string;
  operator: FilterOperator;
  value?: unknown;
  value2?: unknown;
  target: "cell" | "row";
  color: string; // background color
  applyToFieldId?: string; // for target=cell, which field gets colored (defaults to fieldId)
}

export interface ViewConfig {
  filters?: FilterGroup;
  sorts?: SortRule[];
  group?: GroupRule;
  hiddenFieldIds?: string[];
  columnOrder?: string[];
  columnWidths?: Record<string, number>;
  frozenCount?: number;
  conditionalFormats?: ConditionalFormatRule[];
  rowHeight?: "short" | "medium" | "tall" | "auto";
  ganttConfig?: GanttConfig;
  kanban?: KanbanConfig;
  calendar?: CalendarConfig;
  gallery?: GalleryConfig;
  form?: FormConfig;
  eisenhower?: EisenhowerConfig;
  report?: ReportConfig;
}

export type ReportChartType = "kpi" | "bar" | "column" | "stacked_column" | "stacked_bar" | "line" | "area" | "pie" | "donut" | "pivot";

/** One chart / pivot in a Report view. Computed client-side from the view's (filtered) tasks. */
export interface ReportWidget {
  id: string;
  title: string;
  type: ReportChartType;
  dimensionFieldId?: string; // group by (rows)
  dimension2FieldId?: string; // split by (columns / stacks)
  measureFieldId?: string; // numeric field for sum/avg/min/max; empty = task count
  aggregation?: "count" | "sum" | "avg" | "min" | "max";
  dateBucket?: "day" | "week" | "month";
  sortDesc?: boolean;
  topN?: number;
  wide?: boolean;
  /** Position/size on the report's 12-column grid (set by dragging / resizing). */
  layout?: { x: number; y: number; w: number; h: number };
}

export interface ReportConfig {
  widgets?: ReportWidget[];
}

export interface GanttConfig {
  taskFieldId?: string;
  taskColumnSizing?: "fixed" | "fit";
  taskColumnWidth?: number;
  startFieldId?: string;
  endFieldId?: string;
  progressFieldId?: string;
  ownerFieldId?: string;
  statusFieldId?: string;
  dependencyFieldId?: string;
  zoom?: "day" | "week" | "month";
}

export interface KanbanConfig {
  groupFieldId?: string;
  cardFieldIds?: string[];
}

export interface CalendarConfig {
  dateFieldId?: string;
  endDateFieldId?: string;
  colorFieldId?: string;
  mode?: "month" | "week" | "day";
}

export interface GalleryConfig {
  /** Attachment field used as cover ("none" = no cover). Default: the task's attachments (first image). */
  coverFieldId?: string;
  cardFieldIds?: string[];
  cardSize?: "small" | "medium" | "large";
  coverFit?: "cover" | "contain";
  /** true (default): cards grow to show wrapped text; false: one-line, equal height. */
  fitContent?: boolean;
}

export interface FormFieldConfig {
  fieldId: string;
  visible: boolean;
  required: boolean;
  description?: string;
  defaultValue?: unknown;
}

export interface FormConditionalRule {
  id: string;
  targetFieldId: string; // hidden unless the condition below is met
  whenFieldId: string;
  operator: FilterOperator;
  value?: unknown;
}

export interface FormConfig {
  fields?: FormFieldConfig[]; // order in this array is the form's field order
  conditionalRules?: FormConditionalRule[];
  submitLabel?: string;
  successMessage?: string;
}

export interface EisenhowerConfig {
  importanceFieldId?: string;
  urgencyFieldId?: string;
  dueDateFieldId?: string; // used only by the "auto-set Urgency from due date" action
  urgentWithinDays?: number;
  cardFieldIds?: string[];
}

function computeCellValue(record: RecordRow, field: FieldRow, byId: Map<string, FieldRow>): unknown {
  const data = record.data as Record<string, unknown>;
  if (field.type === "formula") {
    const cfg = parseFieldConfig(field.config);
    if (!cfg.expression) return null;
    const nameMap: Record<string, string | number | boolean | null> = {};
    for (const f of byId.values()) {
      const v = (data[f.id] as string | number | boolean | null) ?? null;
      nameMap[f.name] = v;
      // System fields keep their English names as aliases, so a formula works in every UI language.
      const en = SYSTEM_FIELD_NAMES_EN[f.id];
      if (en && !(en in nameMap)) nameMap[en] = v;
    }
    return evaluateFormula(cfg.expression, nameMap);
  }
  if (field.type === "created_time") return record.createdAt;
  if (field.type === "modified_time") return record.updatedAt;
  if (field.type === "created_by") return record.createdById;
  return data[field.id] ?? null;
}

export function getCellValue(record: RecordRow, field: FieldRow, fields: FieldRow[]): unknown {
  const byId = new Map(fields.map((f) => [f.id, f]));
  return computeCellValue(record, field, byId);
}

export interface MemberLite {
  id: string;
  name: string;
  avatarColor: string;
}

// Resolves a raw stored cell value (a select option id, a person id, a raw
// date/number/string...) to the human-readable label + color used anywhere
// a value needs to be grouped or charted - shared by grouping (below) and
// the dashboard aggregation engine so both agree on what a "category" means.
export function resolveValueLabel(
  field: FieldRow,
  key: string,
  members: MemberLite[] = []
): { label: string; color?: string } {
  if (key === "__empty__") return { label: "(Empty)", color: "#cbd5e1" };
  const cfg = parseFieldConfig(field.config);
  const option = cfg.options?.find((o) => o.id === key);
  if (option) return { label: option.label, color: option.color };
  if (field.type === "okr_target") {
    const t = resolveOkrTarget(cfg, key);
    if (t) return { label: t.kind === "kr" ? `${t.objectiveTitle} › ${t.title}` : t.title };
  }
  if (["person", "people", "created_by", "modified_by"].includes(field.type)) {
    const member = members.find((m) => m.id === key);
    if (member) return { label: member.name, color: member.avatarColor };
  }
  if (field.type === "team") {
    const team = cfg.teams?.find((candidate) => candidate.id === key);
    if (team) return { label: team.name, color: team.color };
  }
  if (typeof key === "boolean") return { label: key ? "Yes" : "No" };
  if (key === "true" || key === "false") return { label: key === "true" ? "Yes" : "No" };
  return { label: key };
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function matchesCondition(
  value: unknown,
  op: FilterOperator,
  target?: unknown,
  target2?: unknown,
  currentUserId?: string
): boolean {
  const now = new Date();
  switch (op) {
    case "is_empty":
      return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
    case "is_not_empty":
      return !matchesCondition(value, "is_empty");
    case "contains":
      return String(value ?? "").toLowerCase().includes(String(target ?? "").toLowerCase());
    case "not_contains":
      return !String(value ?? "").toLowerCase().includes(String(target ?? "").toLowerCase());
    case "equals":
      return String(value ?? "") === String(target ?? "");
    case "not_equals":
      return String(value ?? "") !== String(target ?? "");
    case "gt":
      return Number(value) > Number(target);
    case "gte":
      return Number(value) >= Number(target);
    case "lt":
      return Number(value) < Number(target);
    case "lte":
      return Number(value) <= Number(target);
    case "between":
      return Number(value) >= Number(target) && Number(value) <= Number(target2);
    case "before":
      return value ? new Date(value as string) < new Date(target as string) : false;
    case "after":
      return value ? new Date(value as string) > new Date(target as string) : false;
    case "today":
      return value ? startOfDay(new Date(value as string)).getTime() === startOfDay(now).getTime() : false;
    case "yesterday": {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return value ? startOfDay(new Date(value as string)).getTime() === startOfDay(y).getTime() : false;
    }
    case "this_week": {
      const start = new Date(now);
      start.setDate(now.getDate() - now.getDay());
      const end = new Date(start);
      end.setDate(start.getDate() + 7);
      return value ? new Date(value as string) >= startOfDay(start) && new Date(value as string) < end : false;
    }
    case "this_month":
      return value
        ? new Date(value as string).getMonth() === now.getMonth() &&
          new Date(value as string).getFullYear() === now.getFullYear()
        : false;
    case "is":
      return String(value ?? "") === String(target ?? "");
    case "is_not":
      return String(value ?? "") !== String(target ?? "");
    case "contains_any": {
      const arr = Array.isArray(value) ? value : [value];
      const targets = Array.isArray(target) ? target : [target];
      return arr.some((v) => targets.includes(v));
    }
    case "contains_all": {
      const arr = Array.isArray(value) ? value : [value];
      const targets = Array.isArray(target) ? target : [target];
      return targets.every((t) => arr.includes(t));
    }
    case "is_current_user": {
      const values = Array.isArray(value) ? value.map(String) : [String(value ?? "")];
      return currentUserId ? values.includes(currentUserId) : false;
    }
    default:
      return true;
  }
}

export function applyFilters(
  records: RecordRow[],
  fields: FieldRow[],
  filterGroup: FilterGroup | undefined,
  currentUserId?: string
): RecordRow[] {
  if (!filterGroup || !filterGroup.conditions?.length) return records;
  const byId = new Map(fields.map((f) => [f.id, f]));
  return records.filter((record) => {
    const results = filterGroup.conditions.map((cond) => {
      const field = byId.get(cond.fieldId);
      if (!field) return true;
      const value = computeCellValue(record, field, byId);
      return matchesCondition(value, cond.operator, cond.value, cond.value2, currentUserId);
    });
    return filterGroup.conjunction === "OR" ? results.some(Boolean) : results.every(Boolean);
  });
}

export function applySorts(records: RecordRow[], fields: FieldRow[], sorts: SortRule[] | undefined): RecordRow[] {
  if (!sorts || !sorts.length) return [...records].sort((a, b) => a.order - b.order);
  const byId = new Map(fields.map((f) => [f.id, f]));
  return [...records].sort((a, b) => {
    for (const sort of sorts) {
      const field = byId.get(sort.fieldId);
      if (!field) continue;
      const av = computeCellValue(a, field, byId);
      const bv = computeCellValue(b, field, byId);
      let cmp = 0;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av ?? "").localeCompare(String(bv ?? ""));
      if (cmp !== 0) return sort.direction === "asc" ? cmp : -cmp;
    }
    return a.order - b.order;
  });
}

export interface RecordGroup {
  key: string;
  label: string;
  color?: string;
  records: RecordRow[];
  aggregate?: number;
}

export function applyGroup(
  records: RecordRow[],
  fields: FieldRow[],
  group: GroupRule | undefined,
  members: MemberLite[] = []
): RecordGroup[] | null {
  if (!group || !group.fieldId) return null;
  const byId = new Map(fields.map((f) => [f.id, f]));
  const field = byId.get(group.fieldId);
  if (!field) return null;
  const groups = new Map<string, RecordRow[]>();
  for (const record of records) {
    const value = computeCellValue(record, field, byId);
    const keys = Array.isArray(value) ? (value.length ? value : ["__empty__"]) : [value ?? "__empty__"];
    for (const key of keys) {
      const k = String(key);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(record);
    }
  }
  const aggField = group.aggFieldId ? byId.get(group.aggFieldId) : null;
  const result: RecordGroup[] = [];
  for (const [key, recs] of groups) {
    const { label, color } = resolveValueLabel(field, key, members);
    let aggregate: number | undefined;
    if (aggField && group.aggFn) {
      const nums = recs.map((r) => Number(computeCellValue(r, aggField, byId)) || 0);
      if (group.aggFn === "count") aggregate = recs.length;
      else if (group.aggFn === "sum") aggregate = nums.reduce((a, b) => a + b, 0);
      else if (group.aggFn === "avg") aggregate = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
      else if (group.aggFn === "min") aggregate = nums.length ? Math.min(...nums) : 0;
      else if (group.aggFn === "max") aggregate = nums.length ? Math.max(...nums) : 0;
    }
    result.push({ key, label, color, records: recs, aggregate });
  }
  result.sort((a, b) => a.label.localeCompare(b.label));
  return result;
}

export function getConditionalStyle(
  record: RecordRow,
  fields: FieldRow[],
  rules: ConditionalFormatRule[] | undefined,
  cellFieldId: string
): { backgroundColor?: string; rowColor?: string } {
  if (!rules?.length) return {};
  const byId = new Map(fields.map((f) => [f.id, f]));
  let backgroundColor: string | undefined;
  let rowColor: string | undefined;
  for (const rule of rules) {
    const field = byId.get(rule.fieldId);
    if (!field) continue;
    const value = computeCellValue(record, field, byId);
    if (!matchesCondition(value, rule.operator, rule.value, rule.value2)) continue;
    if (rule.target === "row") rowColor = rule.color;
    else if ((rule.applyToFieldId ?? rule.fieldId) === cellFieldId) backgroundColor = rule.color;
  }
  return { backgroundColor, rowColor };
}

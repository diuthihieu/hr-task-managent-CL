// D3: dashboard slicers that work like Power BI's:
//  - one filter state shared by every widget (KPI, tables, charts) of the dashboard;
//  - OR between the values picked in one slicer, AND between slicers; nothing picked = no filter;
//  - a slicer applies to every data source with a field of that name (case ignored) and leaves the
//    others alone; picked values with no data give no rows, they are never dropped;
//  - date slicers are a range including both ends (day precision, as the charts' day buckets);
//  - a slicer's options (with counts) follow the other slicers, not its own selection.
// Values are compared by their label (option label, person name, "(Empty)"), the same text the
// options list shows, so a slicer works across appended projects whose option ids differ.
import type { FieldRow, RecordRow } from "@/types";
import { DATE_TYPES, groupKeysOf } from "./dashboard-engine";
import { resolveValueLabel, type FilterCondition, type MemberLite } from "./query-engine";
import { fieldMatchesName } from "./system-field-names";

export interface SlicerSelection {
  fieldName: string;
  /** List slicer: the labels picked. */
  values?: string[];
  /** Date slicer: first and last day (YYYY-MM-DD), both included; either may be missing. */
  from?: string;
  to?: string;
}

export interface SlicerDef extends SlicerSelection {
  id: string;
}

/** Most values one slicer may pick (the dropdown never picks more, so what is ticked is what filters). */
export const MAX_SLICER_VALUES = 500;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const shiftDay = (day: string, by: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
};

/** A slicer from a request or saved dashboard (current shape, or the old one-value / before / after / between one), bounded. */
export function normalizeSlicer(raw: unknown): SlicerSelection | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const fieldName = typeof r.fieldName === "string" ? r.fieldName.trim().slice(0, 200) : "";
  if (!fieldName) return null;
  const day = (v: unknown) => (typeof v === "string" && DAY.test(v) ? v : undefined);
  if (typeof r.label === "string" && !("values" in r) && !("from" in r) && !("to" in r)) {
    // Old shape: { label, operator: is | before | after | between, value2 }.
    if (r.operator === "between") return { fieldName, from: day(r.label), to: day(r.value2) };
    if (r.operator === "after") return day(r.label) ? { fieldName, from: shiftDay(r.label as string, 1) } : null;
    if (r.operator === "before") return day(r.label) ? { fieldName, to: shiftDay(r.label as string, -1) } : null;
    return { fieldName, values: [r.label.slice(0, 500)] };
  }
  const out: SlicerSelection = { fieldName };
  if (Array.isArray(r.values)) out.values = [...new Set(r.values.filter((v): v is string => typeof v === "string").map((v) => v.slice(0, 500)))].slice(0, MAX_SLICER_VALUES);
  if (day(r.from)) out.from = day(r.from);
  if (day(r.to)) out.to = day(r.to);
  return out;
}

export function slicerActive(s: SlicerSelection): boolean {
  return !!(s.values?.length || s.from || s.to);
}

const norm = (s: string) => s.trim().toLowerCase();

const fieldNamed = (fields: FieldRow[], name: string) => fields.find((f) => fieldMatchesName(f, name));

/** The labels a record shows for a field: one per value ("(Empty)" when none); dates as YYYY-MM-DD. */
function labelsOf(record: RecordRow, field: FieldRow, fields: FieldRow[], members: MemberLite[]): string[] {
  const keys = groupKeysOf(record, field, fields, "day");
  return DATE_TYPES.includes(field.type) ? keys : keys.map((k) => resolveValueLabel(field, k, members).label);
}

function matches(record: RecordRow, field: FieldRow, fields: FieldRow[], members: MemberLite[], s: SlicerSelection): boolean {
  if (DATE_TYPES.includes(field.type)) {
    const day = labelsOf(record, field, fields, members)[0];
    // Picked days (an old "Due date = 2026-10-01" slicer, or values sent by a client): any of them.
    if (s.values?.length && !s.values.some((v) => v.slice(0, 10) === day)) return false;
    if (!s.from && !s.to) return true;
    return day !== "__empty__" && (!s.from || day >= s.from) && (!s.to || day <= s.to);
  }
  if (!s.values?.length) return true;
  const picked = new Set(s.values.map(norm));
  return labelsOf(record, field, fields, members).some((l) => picked.has(norm(l)));
}

/** The records passing every active slicer that applies to these fields; null when none applies. */
function passing(records: RecordRow[], fields: FieldRow[], members: MemberLite[], slicers: SlicerSelection[]): RecordRow[] | null {
  const applicable = slicers.filter(slicerActive).map((s) => ({ s, field: fieldNamed(fields, s.fieldName) })).filter((x): x is { s: SlicerSelection; field: FieldRow } => !!x.field);
  if (!applicable.length) return null;
  return records.filter((r) => applicable.every(({ s, field }) => matches(r, field, fields, members, s)));
}

/** Filter conditions for a widget's records: one "record is one of" condition when any slicer applies. */
export function slicerConditions(records: RecordRow[], fields: FieldRow[], members: MemberLite[], slicers: SlicerSelection[] | undefined): FilterCondition[] {
  const kept = passing(records, fields, members, slicers ?? []);
  return kept ? [{ id: "__slicers__", fieldId: "__record__", operator: "record_in", value: kept.map((r) => r.id) }] : [];
}

export interface SlicerOptions {
  /** Whether this data has a field of that name at all. */
  found: boolean;
  kind: "list" | "date";
  /** List slicer: every value with the number of tasks having it, after the other slicers. */
  values: { label: string; count: number }[];
  /** Date slicer: the first and last day in the data, after the other slicers. */
  min?: string;
  max?: string;
  /** The tasks behind each value (to merge sources without counting a task twice); not sent to clients. */
  tasks?: Map<string, Set<string>>;
}

/** A slicer's options in one data source, narrowed by the other slicers (never by its own selection). */
export function slicerOptions(records: RecordRow[], fields: FieldRow[], members: MemberLite[], slicer: { fieldName: string }, all: SlicerSelection[]): SlicerOptions {
  const field = fieldNamed(fields, slicer.fieldName);
  if (!field) return { found: false, kind: "list", values: [] };
  const others = all.filter((s) => !fieldMatchesName(field, s.fieldName));
  const rows = passing(records, fields, members, others) ?? records;
  if (DATE_TYPES.includes(field.type)) {
    const days = rows.map((r) => labelsOf(r, field, fields, members)[0]).filter((d) => d !== "__empty__").sort();
    return { found: true, kind: "date", values: [], min: days[0], max: days[days.length - 1] };
  }
  const tasks = new Map<string, Set<string>>();
  for (const r of rows) for (const l of labelsOf(r, field, fields, members)) tasks.set(l, (tasks.get(l) ?? new Set()).add(r.id));
  return { found: true, kind: "list", values: sortedValues(tasks), tasks };
}

const sortedValues = (tasks: Map<string, Set<string>>) =>
  [...tasks.entries()].map(([label, ids]) => ({ label, count: ids.size })).sort((a, b) => (a.label === "(Empty)" ? 1 : b.label === "(Empty)" ? -1 : a.label.localeCompare(b.label)));

/** Options of one slicer over several data sources (a dashboard's widgets): tasks counted once, date range widened. */
export function mergeSlicerOptions(parts: SlicerOptions[]): SlicerOptions {
  const found = parts.filter((p) => p.found);
  if (!found.length) return { found: false, kind: "list", values: [] };
  const kind = found.some((p) => p.kind === "date") ? "date" : "list";
  // Two widgets may read the same project: a task counts once per value.
  const tasks = new Map<string, Set<string>>();
  for (const p of found) for (const [label, ids] of p.tasks ?? []) tasks.set(label, new Set([...(tasks.get(label) ?? []), ...ids]));
  const values = sortedValues(tasks);
  const mins = found.map((p) => p.min).filter((d): d is string => !!d).sort();
  const maxs = found.map((p) => p.max).filter((d): d is string => !!d).sort();
  return { found: true, kind, values, min: mins[0], max: maxs[maxs.length - 1] };
}

/** Picked values plus some more (case ignored), at most MAX_SLICER_VALUES; `capped` when some were left out. */
export function addSlicerValues(picked: string[], add: string[]): { values: string[]; capped: boolean } {
  const seen = new Set(picked.map(norm));
  const values = [...picked];
  for (const v of add) {
    if (seen.has(norm(v))) continue;
    if (values.length >= MAX_SLICER_VALUES) return { values, capped: true };
    seen.add(norm(v));
    values.push(v);
  }
  return { values, capped: false };
}

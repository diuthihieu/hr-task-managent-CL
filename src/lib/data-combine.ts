// Power Query-like data sources for dashboard widgets (U8b), on already-authorized records:
//  - Append: stack the tasks of several projects into one table (fields matched by id or by name);
//  - Merge: left join another project's tasks on a key field and bring some of its columns along.
import { parseFieldConfig } from "./field-types";
import { getCellValue } from "./query-engine";
import type { FieldRow, RecordRow } from "@/types";

export interface Source {
  name: string;
  fields: FieldRow[];
  records: RecordRow[];
}

/** Synthetic column holding each row's project name (useful to split a pivot by project). */
export const PROJECT_FIELD_ID = "__project";

const COMPUTED = new Set(["formula", "lookup", "rollup", "button"]);
const norm = (s: string) => s.trim().toLowerCase();

function withOptions(field: FieldRow, extra: { id: string }[]): FieldRow {
  const cfg = parseFieldConfig(field.config) as Record<string, unknown> & { options?: { id: string }[] };
  const have = new Set((cfg.options ?? []).map((o) => o.id));
  const add = extra.filter((o) => !have.has(o.id));
  return add.length ? { ...field, config: JSON.stringify({ ...cfg, options: [...(cfg.options ?? []), ...add] }) } : field;
}

/** One column of resolved values (formulas, lookups...) so they survive the move to another table. */
const resolved = (src: Source, r: RecordRow, f: FieldRow) => (COMPUTED.has(f.type) ? getCellValue(r, f, src.fields) : r.data[f.id]);

export function appendSources(base: Source, others: Source[]): Source {
  let fields = base.fields.map((f) => f);
  const records: RecordRow[] = base.records.map((r) => ({ ...r, data: { ...r.data, [PROJECT_FIELD_ID]: base.name } as Record<string, unknown> }));
  for (const other of others) {
    const map = new Map<string, FieldRow>(); // base field id -> other field
    for (const f of fields) {
      const match = other.fields.find((o) => o.id === f.id) ?? other.fields.find((o) => norm(o.name) === norm(f.name) && o.type === f.type);
      if (match) map.set(f.id, match);
    }
    fields = fields.map((f) => {
      const o = map.get(f.id);
      return o ? withOptions(f, parseFieldConfig(o.config).options ?? []) : f;
    });
    for (const r of other.records) {
      const data: Record<string, unknown> = { [PROJECT_FIELD_ID]: other.name };
      for (const [baseId, o] of map) data[baseId] = resolved(other, r, o);
      records.push({ ...r, data });
    }
  }
  const project: FieldRow = { id: PROJECT_FIELD_ID, projectId: base.fields[0]?.projectId ?? "", name: "Project", type: "text", config: null, order: 9999, isPrimary: false, visible: true, description: null, defaultValue: null, readOnly: true };
  return { name: base.name, fields: [...fields, project], records };
}

/** Text used to match keys: option labels for selects, ids otherwise; case and spaces ignored. */
function keyText(field: FieldRow, value: unknown): string {
  const options = parseFieldConfig(field.config).options ?? [];
  const one = (v: unknown) => norm(String(options.find((o) => o.id === v)?.label ?? v ?? ""));
  return Array.isArray(value) ? value.map(one).sort().join("|") : one(value);
}

export function mergeSource(left: Source, right: Source, o: { leftFieldId: string; rightFieldId: string; fieldIds: string[] }): Source {
  const lf = left.fields.find((f) => f.id === o.leftFieldId);
  const rf = right.fields.find((f) => f.id === o.rightFieldId);
  if (!lf || !rf) return left;
  const index = new Map<string, RecordRow>();
  for (const r of right.records) {
    const k = keyText(rf, getCellValue(r, rf, right.fields));
    if (k && !index.has(k)) index.set(k, r); // first match wins, like a lookup
  }
  const brought = o.fieldIds.map((id) => right.fields.find((f) => f.id === id)).filter((f): f is FieldRow => !!f);
  const newFields: FieldRow[] = brought.map((f, i) => ({
    ...f,
    id: `m:${f.id}`,
    name: `${right.name} · ${f.name}`,
    type: COMPUTED.has(f.type) ? "text" : f.type,
    order: 10000 + i,
    isPrimary: false,
    readOnly: true,
    system: false,
  }));
  const records = left.records.map((r) => {
    const match = index.get(keyText(lf, getCellValue(r, lf, left.fields)));
    if (!match) return r;
    const data = { ...r.data };
    brought.forEach((f) => (data[`m:${f.id}`] = resolved(right, match, f)));
    return { ...r, data };
  });
  return { name: left.name, fields: [...left.fields, ...newFields], records };
}

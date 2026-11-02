// D4: the summary table as a Power BI-like matrix. Several row fields and column fields (the first is
// the parent, the next ones its children), a subtotal for every group at every level, levels the
// viewer can hide (numbers worked out again without them), and an export of exactly what is shown.
//
// Same counting rules as the one-level table (U8): a task with several values (assignees...) counts
// in full under each of them (person-hours); sums and counts add their children up, so a subtotal is
// the sum of the rows under it; an average / min / max / distinct subtotal is worked out from the
// tasks under it; summing estimate / actual hours counts a parent task only for its own share.
import type { FieldRow, RecordRow } from "@/types";
import { aggregate, DATE_TYPES, groupKeysOf, measureValue, type DashboardBlockConfig } from "./dashboard-engine";
import { applyFilters, getCellValue, resolveValueLabel, type MemberLite } from "./query-engine";

export interface MatrixNode {
  key: string;
  label: string;
  /** Keys from the top level down, joined - stable id for expand / collapse. */
  path: string;
  depth: number;
  /** One value per entry of `columns`. */
  values: number[];
  total: number;
  children?: MatrixNode[];
}

export interface MatrixColumn {
  /** Labels from the top column level down to this column's level. */
  labels: string[];
  /** A parent column group's subtotal (shown after its children). */
  subtotal: boolean;
}

export interface MatrixTable {
  rowFields: string[];
  colFields: string[];
  /** Row / column field ids actually used (after the viewer's hidden levels). */
  rowFieldIds: string[];
  colFieldIds: string[];
  /** Every row / column level of the widget, for the viewer's show / hide list. */
  available: { rows: { id: string; name: string }[]; cols: { id: string; name: string }[] };
  columns: MatrixColumn[];
  rows: MatrixNode[];
  /** Grand total row, one value per column. */
  totals: number[];
  total: number;
}

const SEP = "\u0001";
const MAX_LEVELS = 4;
const round = (n: number) => Math.round(n * 100) / 100;

/** Row / column field ids of a summary table config (new lists, else the one-field legacy keys), bounded. */
export function matrixFieldIds(config: DashboardBlockConfig): { rows: string[]; cols: string[] } {
  const rows = config.rowFieldIds?.length ? config.rowFieldIds : config.dimensionFieldId ? [config.dimensionFieldId] : [];
  const cols = config.colFieldIds?.length ? config.colFieldIds : config.dimension2FieldId ? [config.dimension2FieldId] : [];
  return { rows: [...new Set(rows)].slice(0, MAX_LEVELS), cols: [...new Set(cols)].slice(0, MAX_LEVELS) };
}

interface Tree {
  key: string;
  label: string;
  path: string;
  children: Map<string, Tree>;
}

export function computeMatrix(
  records: RecordRow[],
  fields: FieldRow[],
  config: DashboardBlockConfig,
  members: MemberLite[],
  currentUserId?: string,
  /** Levels the viewer keeps (ids from the config, in its order); missing = all. */
  levels?: { rows?: string[]; cols?: string[] },
): MatrixTable {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const configured = matrixFieldIds(config);
  const keep = (ids: string[], wanted?: string[]) => (wanted ? ids.filter((id) => wanted.includes(id)) : ids);
  let rowIds = keep(configured.rows, levels?.rows).filter((id) => byId.has(id));
  if (!rowIds.length) rowIds = configured.rows.filter((id) => byId.has(id)).slice(0, 1); // at least one row level
  const colIds = keep(configured.cols, levels?.cols).filter((id) => byId.has(id));
  const rowFields = rowIds.map((id) => byId.get(id)!);
  const colFields = colIds.map((id) => byId.get(id)!);
  const measure = config.measureFieldId ? byId.get(config.measureFieldId) : undefined;
  const aggFn = config.aggregation ?? "count";
  const additive = aggFn === "sum" || aggFn === "count";
  const valueOf = measureValue(records, fields, measure, aggFn);
  const filtered = applyFilters(records, fields, config.filters, currentUserId);
  const bucket = config.dateBucket ?? "day";
  const labelOf = (f: FieldRow, key: string) => (DATE_TYPES.includes(f.type) && key !== "__empty__" ? key : resolveValueLabel(f, key, members).label);

  // Every combination of a record's values over the levels (a task with 2 assignees has 2 paths).
  const pathsOf = (r: RecordRow, fs: FieldRow[]): string[][] => fs.reduce<string[][]>((acc, f) => acc.flatMap((p) => groupKeysOf(r, f, fields, bucket).map((k) => [...p, k])), [[]]);
  const insert = (root: Map<string, Tree>, keys: string[], fs: FieldRow[]) => {
    let level = root;
    keys.forEach((k, i) => {
      if (!level.has(k)) level.set(k, { key: k, label: labelOf(fs[i], k), path: keys.slice(0, i + 1).join(SEP), children: new Map() });
      level = level.get(k)!.children;
    });
  };

  // Records of each (full row path, full column path) cell.
  const rowRoot = new Map<string, Tree>();
  const colRoot = new Map<string, Tree>();
  const cells = new Map<string, RecordRow[]>();
  for (const r of filtered) {
    const rps = pathsOf(r, rowFields);
    const cps = pathsOf(r, colFields);
    for (const rp of rps) {
      insert(rowRoot, rp, rowFields);
      for (const cp of cps) {
        insert(colRoot, cp, colFields);
        const k = `${rp.join(SEP)}\u0000${cp.join(SEP)}`;
        cells.set(k, [...(cells.get(k) ?? []), r]);
      }
    }
  }

  const sorted = (m: Map<string, Tree>) => [...m.values()].sort((a, b) => (a.key === "__empty__" ? 1 : b.key === "__empty__" ? -1 : a.label.localeCompare(b.label)));

  // Columns in display order: a group's children, then its subtotal; paths for matching cells.
  const columns: (MatrixColumn & { path: string })[] = [];
  const walkCols = (nodes: Tree[], labels: string[]) => {
    for (const n of nodes) {
      const here = [...labels, n.label];
      if (n.children.size) {
        walkCols(sorted(n.children), here);
        columns.push({ labels: here, subtotal: true, path: n.path });
      } else columns.push({ labels: here, subtotal: false, path: n.path });
    }
  };
  if (colFields.length) walkCols(sorted(colRoot), []);
  else columns.push({ labels: ["Value"], subtotal: false, path: "" });

  // Value of a row prefix x column prefix: additive = sum of the full cells under both (person-hours),
  // otherwise the aggregate of the distinct tasks under both.
  const under = (prefix: string, path: string) => prefix === "" || path === prefix || path.startsWith(prefix + SEP);
  const cellEntries = [...cells.entries()].map(([k, recs]) => {
    const [rp, cp] = k.split("\u0000");
    return { rp, cp, recs };
  });
  const agg = (recs: RecordRow[]) => round(aggregate(recs.map(valueOf), measure ? recs.map((r) => getCellValue(r, measure, fields)) : recs.map((r) => r.id), aggFn, recs.length));
  const valueAt = (rowPrefix: string, colPrefix: string) => {
    const hits = cellEntries.filter((e) => under(rowPrefix, e.rp) && under(colPrefix, e.cp));
    if (additive) return round(hits.reduce((a, e) => a + agg(e.recs), 0));
    const distinct = new Map<string, RecordRow>();
    for (const e of hits) for (const r of e.recs) distinct.set(r.id, r);
    return agg([...distinct.values()]);
  };

  const toNode = (t: Tree, depth: number): MatrixNode => {
    const children = t.children.size ? sorted(t.children).map((c) => toNode(c, depth + 1)) : undefined;
    return { key: t.key, label: t.label, path: t.path, depth, values: columns.map((c) => valueAt(t.path, c.path)), total: valueAt(t.path, ""), ...(children ? { children } : {}) };
  };
  const rows = sorted(rowRoot).map((t) => toNode(t, 0));
  return {
    rowFields: rowFields.map((f) => f.name),
    colFields: colFields.map((f) => f.name),
    rowFieldIds: rowIds,
    colFieldIds: colIds,
    available: {
      rows: configured.rows.filter((id) => byId.has(id)).map((id) => ({ id, name: byId.get(id)!.name })),
      cols: configured.cols.filter((id) => byId.has(id)).map((id) => ({ id, name: byId.get(id)!.name })),
    },
    columns: columns.map(({ labels, subtotal }) => ({ labels, subtotal })),
    rows,
    totals: columns.map((c) => valueAt("", c.path)),
    total: valueAt("", ""),
  };
}

/**
 * The matrix as shown, for CSV / Excel: one column per row level (a child repeats its parent's label),
 * then one column per value column (multi-level headers joined with " › "), then the total. Children of
 * collapsed rows are left out, like on screen.
 */
export function matrixRowsForExport(m: MatrixTable, collapsed: Set<string>, totalLabel = "Total"): (string | number)[][] {
  const levels = m.rowFields.length;
  const hasCols = m.colFields.length > 0;
  const head = [...m.rowFields, ...(hasCols ? m.columns.map((c) => (c.subtotal ? `${c.labels.join(" › ")} ${totalLabel}` : c.labels.join(" › "))) : []), totalLabel];
  const out: (string | number)[][] = [head];
  const walk = (nodes: MatrixNode[], ancestors: string[]) => {
    for (const n of nodes) {
      const labels = [...ancestors, n.label];
      out.push([...labels, ...Array(levels - labels.length).fill(""), ...(hasCols ? n.values : []), n.total]);
      if (n.children && !collapsed.has(n.path)) walk(n.children, labels);
    }
  };
  walk(m.rows, []);
  out.push([totalLabel, ...Array(levels - 1).fill(""), ...(hasCols ? m.totals : []), m.total]);
  return out;
}

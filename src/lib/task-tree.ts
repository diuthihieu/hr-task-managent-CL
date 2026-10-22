/**
 * Sub-task hierarchy for list views: a task whose parent (sys_parent) is in the same list is shown
 * right under it, indented one level per ancestor. A task whose parent is not in the list (filtered
 * out, another group) is shown at the top level, so nothing disappears. The incoming order (sorting,
 * manual order) is kept among siblings. Pure and cycle-safe.
 */

export interface TreeRecord {
  id: string;
  data: Record<string, unknown>;
}

export interface TreeRow<T extends TreeRecord> {
  record: T;
  depth: number;
  /** Direct children in this list (shown or collapsed). */
  childCount: number;
}

export const parentIdOf = (record: TreeRecord): string | null => {
  const v = record.data.sys_parent;
  const id = Array.isArray(v) ? v[v.length - 1] : v;
  return typeof id === "string" && id ? id : null;
};

/** Rows in display order. Children of a collapsed task are left out (its childCount still says how many). */
export function buildTaskTree<T extends TreeRecord>(records: T[], collapsed: ReadonlySet<string> = new Set()): TreeRow<T>[] {
  const ids = new Set(records.map((r) => r.id));
  const children = new Map<string, T[]>();
  const roots: T[] = [];
  for (const r of records) {
    const parent = parentIdOf(r);
    if (parent && parent !== r.id && ids.has(parent)) children.set(parent, [...(children.get(parent) ?? []), r]);
    else roots.push(r);
  }
  const out: TreeRow<T>[] = [];
  const placed = new Set<string>();
  const visit = (r: T, depth: number) => {
    if (placed.has(r.id)) return; // a cycle in bad data: show each task once
    placed.add(r.id);
    const kids = children.get(r.id) ?? [];
    out.push({ record: r, depth, childCount: kids.length });
    if (collapsed.has(r.id)) {
      // Still mark hidden descendants as placed so the cycle fallback below does not surface them.
      const hide = (x: T) => {
        for (const k of children.get(x.id) ?? []) {
          if (placed.has(k.id)) continue;
          placed.add(k.id);
          hide(k);
        }
      };
      hide(r);
      return;
    }
    for (const k of kids) visit(k, depth + 1);
  };
  for (const r of roots) visit(r, 0);
  // Tasks only reachable through a cycle (no root) are shown at the top level rather than lost.
  for (const r of records) if (!placed.has(r.id)) visit(r, 0);
  return out;
}

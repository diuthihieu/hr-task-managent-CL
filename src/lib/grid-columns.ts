import type { FieldRow } from "@/types";

/**
 * The columns a table view shows, in its order: the saved column order, minus hidden fields.
 * Fields missing from a saved order: a newly added built-in column goes right after the field that
 * precedes it in the default order; new custom columns go last.
 */
export function orderVisibleFields(fields: FieldRow[], columnOrder: string[], hiddenFieldIds: string[]): FieldRow[] {
  const byId = new Map(fields.map((f) => [f.id, f]));
  if (!columnOrder.length) return fields.filter((f) => !hiddenFieldIds.includes(f.id));
  const ordered = columnOrder.map((id) => byId.get(id)).filter(Boolean) as FieldRow[];
  fields.forEach((f, i) => {
    if (ordered.includes(f)) return;
    if (!f.system) return void ordered.push(f);
    const prev = fields.slice(0, i).reverse().find((p) => ordered.includes(p));
    ordered.splice(prev ? ordered.indexOf(prev) + 1 : 0, 0, f);
  });
  return ordered.filter((f) => !hiddenFieldIds.includes(f.id));
}

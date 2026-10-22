import type { FieldRow } from "@/types";
import { isGridFieldPasteable } from "./grid-clipboard";

/** Group key `applyGroup` uses for records without a value. */
export const EMPTY_GROUP_KEY = "__empty__";

/** Types whose value cannot be rebuilt from a group key (objects, files, signatures...). */
const NOT_SETTABLE = new Set(["okr_target", "location", "json", "attachment", "signature", "task_attachments", "button"]);
const MULTI = new Set(["multi_select", "people", "link"]);

/**
 * The value a new row needs so it lands in the group it was inserted in (grid grouped by `field`).
 * `sample` is the field's value on a row of that group, so ids / numbers / booleans keep their type;
 * for multi-value fields (people, multi select, links) only the group's own value is used.
 * Returns null when the group's value cannot be written (computed or read-only fields, title, status "empty").
 */
export function groupFieldPatch(field: FieldRow, key: string, sample: unknown): Record<string, unknown> | null {
  if (field.isPrimary || !isGridFieldPasteable(field) || NOT_SETTABLE.has(field.type)) return null;
  if (key === EMPTY_GROUP_KEY) {
    if (field.type === "status") return null; // every task has a status
    return { [field.id]: MULTI.has(field.type) ? [] : null };
  }
  if (Array.isArray(sample)) {
    const hit = sample.find((v) => String(v) === key);
    return hit === undefined ? null : { [field.id]: [hit] };
  }
  if (sample === null || sample === undefined || String(sample) !== key) return null;
  return { [field.id]: MULTI.has(field.type) ? [sample] : sample };
}

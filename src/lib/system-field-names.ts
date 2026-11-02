// English names of the built-in task fields (client-safe, no server imports).
// Formulas may reference these even when the UI shows translated names.
import { makeT, type MessageKey } from "./i18n/core";

const SYSTEM_IDS = [
  "sys_title", "sys_status", "sys_assignees", "sys_report_to", "sys_priority", "sys_category", "sys_start_date", "sys_due_date", "sys_progress", "sys_completed_at", "sys_estimate", "sys_actual",
  "sys_objective", "sys_importance", "sys_urgency", "sys_depends_on", "sys_parent", "sys_description", "sys_attachments", "sys_created_at", "sys_updated_at", "sys_created_by", "sys_updated_by",
];

const en = makeT("en");
export const SYSTEM_FIELD_NAMES_EN: Record<string, string> = Object.fromEntries(SYSTEM_IDS.map((id) => [id, en(`field.${id}` as MessageKey)]));

const vi = makeT("vi");
/** Every name a built-in field goes by (English and Vietnamese), lower-cased. */
const SYSTEM_FIELD_ALIASES: Record<string, Set<string>> = Object.fromEntries(SYSTEM_IDS.map((id) => [id, new Set([en(`field.${id}` as MessageKey), vi(`field.${id}` as MessageKey)].map((n) => n.trim().toLowerCase()))]));

/**
 * Whether a field is the one a dashboard slicer / chart click names. Built-in fields are shown in the
 * viewer's language ("Hạn chót" / "Due date") but the server reads them in English, so both names match.
 */
export function fieldMatchesName(field: { id: string; name: string }, name: string): boolean {
  const n = name.trim().toLowerCase();
  return field.name.trim().toLowerCase() === n || !!SYSTEM_FIELD_ALIASES[field.id]?.has(n);
}

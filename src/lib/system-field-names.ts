// English names of the built-in task fields (client-safe, no server imports).
// Formulas may reference these even when the UI shows translated names.
import { makeT, type MessageKey } from "./i18n/core";

const SYSTEM_IDS = [
  "sys_title", "sys_status", "sys_assignees", "sys_report_to", "sys_priority", "sys_category", "sys_start_date", "sys_due_date", "sys_progress", "sys_estimate", "sys_actual",
  "sys_objective", "sys_importance", "sys_urgency", "sys_depends_on", "sys_parent", "sys_description", "sys_attachments", "sys_created_at", "sys_updated_at", "sys_created_by",
];

const en = makeT("en");
export const SYSTEM_FIELD_NAMES_EN: Record<string, string> = Object.fromEntries(SYSTEM_IDS.map((id) => [id, en(`field.${id}` as MessageKey)]));

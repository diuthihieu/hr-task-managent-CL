// Task field ids and the coercion of incoming cell values to typed columns (pure: no database).
import { badRequest } from "@/lib/http-errors";

export const SYS = {
  title: "sys_title",
  status: "sys_status",
  assignees: "sys_assignees",
  reportTo: "sys_report_to",
  priority: "sys_priority",
  category: "sys_category",
  startDate: "sys_start_date",
  dueDate: "sys_due_date",
  progress: "sys_progress",
  /** When the task was finished: set automatically on "done", editable. */
  completedAt: "sys_completed_at",
  estimate: "sys_estimate",
  actual: "sys_actual",
  keyResult: "sys_key_result",
  objective: "sys_objective",
  attachments: "sys_attachments",
  importance: "sys_importance",
  urgency: "sys_urgency",
  dependsOn: "sys_depends_on",
  parent: "sys_parent",
  description: "sys_description",
  createdAt: "sys_created_at",
  updatedAt: "sys_updated_at",
  createdBy: "sys_created_by",
  updatedBy: "sys_updated_by",
  /** Not a grid column: { freq: "daily" | "weekly" | "monthly", interval: n } or null. */
  recurrence: "sys_recurrence",
} as const;

export const PRIORITIES = ["low", "medium", "high", "critical"] as const;

export const READ_ONLY_SYS = new Set<string>([SYS.createdAt, SYS.updatedAt, SYS.createdBy, SYS.updatedBy, SYS.attachments]);

/** Value of the "Objective" task field: `kr:<id>` (key result, objective implied) or `obj:<id>` (objective only). */
export function okrTargetToken(task: { keyResultId: string | null; objectiveId: string | null }): string | null {
  if (task.keyResultId) return `kr:${task.keyResultId}`;
  if (task.objectiveId) return `obj:${task.objectiveId}`;
  return null;
}

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

export const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

/** `@db.Date` columns: accept "YYYY-MM-DD" or an ISO string, store as UTC midnight. */
export function toDateOnly(v: unknown, label: string): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string" || !DATE_RE.test(v)) throw badRequest(`${label} must be a date (YYYY-MM-DD)`);
  const [y, m, d] = v.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.getTime()) || date.getUTCMonth() !== m - 1) throw badRequest(`${label} is not a valid date`);
  return date;
}

export function fromDateOnly(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export function toTimestamp(v: unknown, label: string): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string") throw badRequest(`${label} must be a date/time`);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw badRequest(`${label} is not a valid date/time`);
  return d;
}

export function toNumber(v: unknown, label: string): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) throw badRequest(`${label} must be a number`);
  return n;
}

export function toIdOrNull(v: unknown, label: string): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string") throw badRequest(`${label} must be an id`);
  return v;
}

export function toIdArray(v: unknown, label: string): string[] {
  if (v === null || v === undefined || v === "") return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw badRequest(`${label} must be a list of ids`);
  return [...new Set(v as string[])];
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID_RE.test(s);

export function assertUuids(ids: string[], label: string) {
  for (const id of ids) if (!isUuid(id)) throw badRequest(`${label}: invalid id`);
}

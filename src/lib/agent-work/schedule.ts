// Schedules of Agent workflows, in Vietnam time (UTC+7, no daylight saving). Pure, for unit tests.
import { z } from "zod";

export const WORKFLOW_FREQUENCIES = ["hourly", "daily", "weekly", "monthly"] as const;
export const workflowSchedule = z
  .object({
    freq: z.enum(WORKFLOW_FREQUENCIES),
    /** Minute of the hour (all frequencies). */
    minute: z.number().int().min(0).max(59).default(0),
    /** Hour of the day (daily / weekly / monthly). */
    hour: z.number().int().min(0).max(23).default(8),
    /** weekly: days, 0 = Monday … 6 = Sunday. */
    weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([0]),
    /** monthly: day of the month; 31 = the last day. */
    monthDay: z.number().int().min(1).max(31).default(1),
  })
  .refine((s) => s.freq !== "weekly" || s.weekdays.length > 0, "Pick at least one day");
export type WorkflowSchedule = z.infer<typeof workflowSchedule>;

const VN = 7 * 3_600_000;
const HOUR = 3_600_000;

/** The first run time strictly after `after` (a real instant, UTC). */
export function nextRunAt(s: WorkflowSchedule, after: Date): Date {
  // Work in "Vietnam wall clock" milliseconds, then shift back.
  const local = new Date(after.getTime() + VN);
  const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(Date.UTC(y, mo, d, h, mi) - VN);
  const y = local.getUTCFullYear();
  const mo = local.getUTCMonth();
  const d = local.getUTCDate();
  if (s.freq === "hourly") {
    let t = at(y, mo, d, local.getUTCHours(), s.minute);
    if (t <= after) t = new Date(t.getTime() + HOUR);
    return t;
  }
  if (s.freq === "daily") {
    let t = at(y, mo, d, s.hour, s.minute);
    if (t <= after) t = at(y, mo, d + 1, s.hour, s.minute);
    return t;
  }
  if (s.freq === "weekly") {
    const days = new Set(s.weekdays);
    for (let i = 0; i <= 7; i++) {
      const t = at(y, mo, d + i, s.hour, s.minute);
      const dow = (new Date(Date.UTC(y, mo, d + i)).getUTCDay() + 6) % 7;
      if (days.has(dow) && t > after) return t;
    }
    throw new Error("unreachable");
  }
  // monthly: the chosen day, or the month's last day when it is shorter.
  for (let i = 0; i <= 2; i++) {
    const last = new Date(Date.UTC(y, mo + i + 1, 0)).getUTCDate();
    const t = at(y, mo + i, Math.min(s.monthDay, last), s.hour, s.minute);
    if (t > after) return t;
  }
  throw new Error("unreachable");
}

// Arguments of a Skill run by its slash command: date presets, projects, people and text, validated
// against the Skill's parameters. Pure (no database) so it can be unit-tested.
import { DATE_PRESETS, type SkillParameter } from "./skill-schema";

export type DatePreset = (typeof DATE_PRESETS)[number];
export interface DateRangeArg {
  from: string;
  to: string;
  field: "completed" | "due" | "start" | "updated";
}
export type CommandArgValue = string | string[] | DateRangeArg;
export type CommandArgs = Record<string, CommandArgValue>;

const VN_OFFSET_MS = 7 * 3_600_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** A preset as inclusive days in Vietnam time; weeks start on Monday. */
export function resolveDatePreset(preset: DatePreset, now = new Date()): { from: string; to: string } {
  const [y, m, d] = iso(new Date(now.getTime() + VN_OFFSET_MS)).split("-").map(Number);
  const today = new Date(Date.UTC(y, m - 1, d));
  const dow = (today.getUTCDay() + 6) % 7; // Monday = 0
  const monday = addDays(today, -dow);
  const firstOfMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  switch (preset) {
    case "this_week":
      return { from: iso(monday), to: iso(addDays(monday, 6)) };
    case "last_week":
      return { from: iso(addDays(monday, -7)), to: iso(addDays(monday, -1)) };
    case "this_month":
      return { from: iso(firstOfMonth), to: iso(addDays(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1)), -1)) };
    case "last_month":
      return { from: iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1))), to: iso(addDays(firstOfMonth, -1)) };
    case "last_7_days":
      return { from: iso(addDays(today, -6)), to: iso(today) };
    case "last_30_days":
      return { from: iso(addDays(today, -29)), to: iso(today) };
  }
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates raw arguments against the Skill's parameters and fills defaults. "me" in people becomes the
 * caller's id; projects / people ids are checked against the given allowed sets. Throws a readable Error.
 */
export function normalizeCommandArgs(
  parameters: SkillParameter[],
  raw: Record<string, unknown>,
  ctx: { userId: string; projectIds: Set<string>; memberIds: Set<string>; now?: Date },
): CommandArgs {
  const out: CommandArgs = {};
  for (const p of parameters) {
    const v = raw[p.key] ?? p.default;
    if (p.type === "text") {
      const text = typeof v === "string" ? v.trim().slice(0, 2000) : "";
      if (text) out[p.key] = text;
    } else if (p.type === "date_range") {
      const field = p.dateField ?? "completed";
      if (typeof v === "string" && (DATE_PRESETS as readonly string[]).includes(v)) out[p.key] = { ...resolveDatePreset(v as DatePreset, ctx.now), field };
      else if (v && typeof v === "object" && !Array.isArray(v)) {
        const { from, to } = v as { from?: unknown; to?: unknown };
        if (typeof from === "string" && typeof to === "string" && DAY.test(from) && DAY.test(to)) {
          if (from > to) throw new Error(`${p.label}: the start date is after the end date`);
          out[p.key] = { from, to, field };
        }
      }
    } else {
      const list = (Array.isArray(v) ? v : typeof v === "string" && v ? v.split(",") : []).map((x) => String(x).trim()).filter(Boolean);
      const ids = list.map((x) => (x === "me" ? ctx.userId : x));
      const allowed = p.type === "projects" ? ctx.projectIds : ctx.memberIds;
      const bad = ids.find((id) => !allowed.has(id));
      if (bad) throw new Error(`${p.label}: not found or not visible to you`);
      if (ids.length) out[p.key] = [...new Set(ids)];
    }
    if (p.required && out[p.key] === undefined) throw new Error(`${p.label} is required`);
  }
  return out;
}

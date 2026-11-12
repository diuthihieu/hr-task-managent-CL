// Form state of a Skill's parameters (pure, unit-tested).
import type { SkillParameter } from "@/lib/agent-work/skill-schema";

type Range = { from: string | null; to: string | null };
export type ParamValues = Record<string, unknown>;
export type ParamRanges = Record<string, Range>;

/** Form values for a Skill's parameters: saved arguments when given, else the parameter defaults. */
export function initialParamState(params: SkillParameter[], saved?: Record<string, unknown>): { values: ParamValues; ranges: ParamRanges } {
  const values: ParamValues = {};
  const ranges: ParamRanges = {};
  for (const p of params) {
    const v = saved?.[p.key];
    if (p.type === "date_range" && v && typeof v === "object" && !Array.isArray(v)) {
      const r = v as { from?: string; to?: string };
      ranges[p.key] = { from: r.from ?? null, to: r.to ?? null };
      values[p.key] = "";
    } else if (p.type === "projects" || p.type === "people") {
      // Lists: a saved or AI-drafted value may be one id or "me" as a string, or a comma-separated string.
      const list = Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(",").map((x) => x.trim()).filter(Boolean) : null;
      values[p.key] = list ?? (p.type === "people" && p.default === "me" ? ["me"] : []);
    } else if (typeof v === "string") values[p.key] = v;
    else values[p.key] = p.default ?? "";
  }
  return { values, ranges };
}

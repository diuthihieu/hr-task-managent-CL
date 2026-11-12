import { test } from "node:test";
import assert from "node:assert/strict";
import type { SkillParameter } from "@/lib/agent-work/skill-schema";
import { initialParamState } from "./param-state";

const params: SkillParameter[] = [
  { key: "period", label: "Period", type: "date_range", required: false, default: "last_week" },
  { key: "people", label: "People", type: "people", required: false, default: "me" },
  { key: "projects", label: "Projects", type: "projects", required: false },
  { key: "focus", label: "Focus", type: "text", required: false },
];

test("defaults when nothing is saved", () => {
  assert.deepEqual(initialParamState(params).values, { period: "last_week", people: ["me"], projects: [], focus: "" });
});

test("saved lists given as a string (an AI draft's \"me\") become arrays", () => {
  const s = initialParamState(params, { people: "me", projects: "a, b", period: { from: "2026-11-01", to: "2026-11-07" }, focus: "HR" });
  assert.deepEqual(s.values, { period: "", people: ["me"], projects: ["a", "b"], focus: "HR" });
  assert.deepEqual(s.ranges, { period: { from: "2026-11-01", to: "2026-11-07" } });
});

test("a saved value of the wrong shape falls back to the default", () => {
  assert.deepEqual(initialParamState(params, { people: 5, focus: ["x"] }).values, { period: "last_week", people: ["me"], projects: [], focus: "" });
});

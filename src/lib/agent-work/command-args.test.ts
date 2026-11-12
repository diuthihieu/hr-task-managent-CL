import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCommandArgs, resolveDatePreset } from "./command-args";
import type { SkillParameter } from "./skill-schema";

// Thursday 2026-11-12, 23:30 in Vietnam (16:30 UTC).
const now = new Date("2026-11-12T16:30:00Z");

test("date presets: Vietnam days, weeks from Monday, whole months", () => {
  assert.deepEqual(resolveDatePreset("this_week", now), { from: "2026-11-09", to: "2026-11-15" });
  assert.deepEqual(resolveDatePreset("last_week", now), { from: "2026-11-02", to: "2026-11-08" });
  assert.deepEqual(resolveDatePreset("this_month", now), { from: "2026-11-01", to: "2026-11-30" });
  assert.deepEqual(resolveDatePreset("last_month", now), { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(resolveDatePreset("last_7_days", now), { from: "2026-11-06", to: "2026-11-12" });
  // 18:00 UTC on Thursday is already Friday 01:00 in Vietnam.
  assert.deepEqual(resolveDatePreset("last_7_days", new Date("2026-11-12T18:00:00Z")), { from: "2026-11-07", to: "2026-11-13" });
  assert.deepEqual(resolveDatePreset("last_month", new Date("2027-01-05T03:00:00Z")), { from: "2026-12-01", to: "2026-12-31" });
});

const params: SkillParameter[] = [
  { key: "period", label: "Kỳ", type: "date_range", required: true, default: "last_week", dateField: "completed" },
  { key: "projects", label: "Dự án", type: "projects", required: false },
  { key: "people", label: "Người", type: "people", required: false, default: "me" },
  { key: "note", label: "Ghi chú", type: "text", required: false },
];
const ctx = { userId: "u-me", projectIds: new Set(["p1", "p2"]), memberIds: new Set(["u-me", "u-lan"]), now };

test("arguments: defaults, me, explicit ranges, visibility checks", () => {
  assert.deepEqual(normalizeCommandArgs(params, {}, ctx), { period: { from: "2026-11-02", to: "2026-11-08", field: "completed" }, people: ["u-me"] });
  assert.deepEqual(normalizeCommandArgs(params, { period: { from: "2026-10-01", to: "2026-10-31" }, projects: ["p2"], people: ["u-lan", "me"], note: " gấp " }, ctx), {
    period: { from: "2026-10-01", to: "2026-10-31", field: "completed" },
    projects: ["p2"],
    people: ["u-lan", "u-me"],
    note: "gấp",
  });
  assert.throws(() => normalizeCommandArgs(params, { projects: ["p-hidden"] }, ctx), /Dự án: not found/);
  assert.throws(() => normalizeCommandArgs(params, { period: { from: "2026-10-31", to: "2026-10-01" } }, ctx), /start date is after/);
  assert.throws(() => normalizeCommandArgs([{ key: "x", label: "X", type: "text", required: true }], {}, ctx), /X is required/);
});

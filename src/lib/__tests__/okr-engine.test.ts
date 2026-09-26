import { test } from "node:test";
import assert from "node:assert/strict";
import { computeKeyResultProgress, computeObjectiveProgress, resolveTaskOkrWeight, resolveTaskProgress } from "../okr-engine";
import { field } from "./helpers";

const kr = (type: string, extra: Partial<{ startValue: number; targetValue: number; currentValue: number; manualProgress: number | null }> = {}) => ({
  type,
  startValue: 0,
  targetValue: 100,
  currentValue: 0,
  manualProgress: null,
  ...extra,
});

test("numeric KR progress is relative to start/target and clamped", () => {
  assert.equal(computeKeyResultProgress(kr("numeric", { startValue: 10, targetValue: 20, currentValue: 15 }), []), 50);
  assert.equal(computeKeyResultProgress(kr("numeric", { startValue: 10, targetValue: 20, currentValue: 30 }), []), 100);
  assert.equal(computeKeyResultProgress(kr("numeric", { startValue: 10, targetValue: 20, currentValue: 0 }), []), 0);
});

test("manual and percentage KRs", () => {
  assert.equal(computeKeyResultProgress(kr("manual", { manualProgress: 42 }), []), 42);
  assert.equal(computeKeyResultProgress(kr("percentage", { currentValue: 73 }), []), 73);
});

test("task-based KR uses weighted average of linked tasks", () => {
  const p = computeKeyResultProgress(kr("task_based"), [
    { progress: 100, weight: 3 },
    { progress: 0, weight: 1 },
  ]);
  assert.equal(p, 75);
  assert.equal(computeKeyResultProgress(kr("task_based"), []), 0);
});

test("objective progress is weighted over KRs", () => {
  assert.equal(computeObjectiveProgress([{ progress: 100, weight: 1 }, { progress: 50, weight: 1 }]), 75);
  assert.equal(computeObjectiveProgress([]), 0);
});

const statusOptions = {
  options: [
    { id: "a", label: "Đang làm", color: "#000" },
    { id: "b", label: "Hoàn thành", color: "#000" },
    { id: "c", label: "Done", color: "#000" },
  ],
};

test("task progress: progress field wins", () => {
  const fields = [field("p", "Progress", "progress"), field("s", "Status", "status", statusOptions)];
  assert.equal(resolveTaskProgress(fields, { p: 60, s: "c" }), 60);
});

test("task progress: done status in English or Vietnamese counts as 100%", () => {
  const en = [field("s", "Status", "status", statusOptions)];
  assert.equal(resolveTaskProgress(en, { s: "c" }), 100);
  assert.equal(resolveTaskProgress(en, { s: "a" }), 0);
  const vi = [field("s", "Trạng thái", "status", statusOptions)];
  assert.equal(resolveTaskProgress(vi, { s: "b" }), 100);
});

test("task weight falls back to 1", () => {
  const fields = [field("w", "OKR Contribution Weight", "percent")];
  assert.equal(resolveTaskOkrWeight(fields, { w: 40 }), 40);
  assert.equal(resolveTaskOkrWeight(fields, {}), 1);
  assert.equal(resolveTaskOkrWeight([], {}), 1);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeKeyResultProgress, computeObjectiveProgress, resolveTaskProgress } from "../okr-engine";

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

test("task progress: a done-category status counts as 100%, otherwise the task's own progress", () => {
  assert.equal(resolveTaskProgress({ progress: 40, statusCategory: "done" }), 100);
  assert.equal(resolveTaskProgress({ progress: 40, statusCategory: "in_progress" }), 40);
  assert.equal(resolveTaskProgress({ progress: 140, statusCategory: "todo" }), 100);
  assert.equal(resolveTaskProgress({ progress: -5, statusCategory: null }), 0);
});

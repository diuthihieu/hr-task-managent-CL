import { test } from "node:test";
import assert from "node:assert/strict";
import { ownMinutes } from "../hours";

test("a parent's own share is its total minus its sub-tasks, so a branch counts once", () => {
  const own = ownMinutes([
    { id: "p", parentTaskId: null, estimateMinutes: 600, actualMinutes: 480 },
    { id: "c1", parentTaskId: "p", estimateMinutes: 120, actualMinutes: 180 },
    { id: "c2", parentTaskId: "p", estimateMinutes: 60, actualMinutes: null },
    { id: "g", parentTaskId: "c1", estimateMinutes: 60, actualMinutes: 60 },
  ]);
  assert.deepEqual(own.get("p"), { est: 420, act: 300 });
  assert.deepEqual(own.get("c1"), { est: 60, act: 120 });
  assert.deepEqual(own.get("g"), { est: 60, act: 60 });
  const total = [...own.values()].reduce((s, v) => s + v.act, 0);
  assert.equal(total, 480, "sum of own shares = the parent's total");
});

test("never negative when sub-tasks exceed the parent (legacy data)", () => {
  const own = ownMinutes([
    { id: "p", parentTaskId: null, estimateMinutes: 60, actualMinutes: null },
    { id: "c", parentTaskId: "p", estimateMinutes: 120, actualMinutes: 30 },
  ]);
  assert.deepEqual(own.get("p"), { est: 0, act: 0 });
});

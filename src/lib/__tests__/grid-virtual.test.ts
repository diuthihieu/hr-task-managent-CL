import { test } from "node:test";
import assert from "node:assert/strict";
import { keepIndexes, virtualSpacers } from "../grid-virtual";

const items = (idx: number[], h = 36, margin = 40) => idx.map((i) => ({ start: margin + i * h, end: margin + (i + 1) * h }));

test("a kept row outside the window is added, in order, once", () => {
  assert.deepEqual(keepIndexes([100, 101, 102], [0]), [0, 100, 101, 102]);
  assert.deepEqual(keepIndexes([100, 101], [101, -1]), [100, 101]);
  assert.deepEqual(keepIndexes([5, 6], [200, 0]), [0, 5, 6, 200]);
});

test("a kept row far from the window keeps its own offset: the rows between take their space", () => {
  const total = 300 * 36;
  const s = virtualSpacers(items([0, 100, 101, 102]), total, 40);
  assert.deepEqual(s.before, [0, 99 * 36, 0, 0]);
  assert.equal(s.after, total - 103 * 36);
  // Sum of rendered rows and spacers is the full height, as without the kept row.
  assert.equal(s.before.reduce((a, b) => a + b, 0) + 4 * 36 + s.after, total);
});

test("a contiguous window has one spacer above and one below", () => {
  const s = virtualSpacers(items([10, 11, 12]), 100 * 36, 40);
  assert.deepEqual(s.before, [360, 0, 0]);
  assert.equal(s.after, 87 * 36);
  assert.deepEqual(virtualSpacers([], 1000, 40), { before: [], after: 0 });
});

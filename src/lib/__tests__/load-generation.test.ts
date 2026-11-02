import { test } from "node:test";
import assert from "node:assert/strict";
import { LoadGeneration } from "../load-generation";

test("a page requested before a reload is dropped when it arrives after it", () => {
  const g = new LoadGeneration();
  g.restart(); // first load
  const page3 = g.peek(); // "load more" in flight
  const reload = g.restart(); // the record changed: reload page one
  assert.equal(g.isCurrent(reload), true);
  assert.equal(g.isCurrent(page3), false, "page three belongs to the old list");
});

test("an older reload is dropped when a newer one started; load more after a reload is current", () => {
  const g = new LoadGeneration();
  const a = g.restart();
  const b = g.restart();
  assert.equal(g.isCurrent(a), false);
  assert.equal(g.isCurrent(b), true);
  assert.equal(g.isCurrent(g.peek()), true);
});

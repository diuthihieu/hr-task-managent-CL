import assert from "node:assert/strict";
import test from "node:test";
import { anchoredCircularGraphLayout, concentricCircularLayout } from "../radial-graph";

test("Second Brain nodes stay on a circle with a guaranteed visual gap", () => {
  const ids = Array.from({ length: 8 }, (_, index) => `node-${index}`);
  const positions = concentricCircularLayout(ids, { x: 300, y: 200 }, { nodeRadius: 13, minGap: 22, firstRingRadius: 90 });
  const radii = ids.map((id) => Math.hypot(positions[id].x - 300, positions[id].y - 200));
  assert.ok(Math.max(...radii) - Math.min(...radii) < 0.001);
  for (let index = 0; index < ids.length; index++) {
    const current = positions[ids[index]];
    const next = positions[ids[(index + 1) % ids.length]];
    assert.ok(Math.hypot(current.x - next.x, current.y - next.y) >= 48);
  }
});

test("a dense Second Brain graph expands to additional circular rings", () => {
  const ids = Array.from({ length: 60 }, (_, index) => `node-${index}`);
  const positions = concentricCircularLayout(ids, { x: 0, y: 0 }, { nodeRadius: 13, minGap: 22, firstRingRadius: 90 });
  const radii = new Set(ids.map((id) => Math.round(Math.hypot(positions[id].x, positions[id].y))));
  assert.ok(radii.size >= 3);
  assert.equal(Object.keys(positions).length, ids.length);
});

test("dragging a Second Brain node keeps its direct links on the inner rings", () => {
  const all = ["anchor", "linked-c", "other-b", "linked-a", "other-a", "linked-b"];
  const linked = ["linked-c", "linked-a", "linked-b"];
  const positions = anchoredCircularGraphLayout(all, "anchor", linked, { x: 240, y: 180 }, { nodeRadius: 13, minGap: 22, firstRingRadius: 90 });
  const linkedRadii = linked.map((id) => Math.hypot(positions[id].x - 240, positions[id].y - 180));
  const otherRadii = ["other-a", "other-b"].map((id) => Math.hypot(positions[id].x - 240, positions[id].y - 180));
  assert.ok(Math.max(...linkedRadii) < Math.min(...otherRadii));
  assert.ok(Math.max(...linkedRadii) - Math.min(...linkedRadii) < 0.001);
  assert.deepEqual(positions.anchor, { x: 240, y: 180 });
});

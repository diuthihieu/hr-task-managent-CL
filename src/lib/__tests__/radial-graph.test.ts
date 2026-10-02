import assert from "node:assert/strict";
import test from "node:test";
import { anchoredCircularGraphLayout, circularMotionPosition, concentricCircularLayout } from "../radial-graph";

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

test("Second Brain motion changes position without breaking the circular ring", () => {
  const center = { x: 10, y: -5 };
  const base = { x: 110, y: -5 };
  const first = circularMotionPosition(base, center, 1.25, 0);
  const later = circularMotionPosition(base, center, 1.25, 1800);
  assert.notDeepEqual(first, later);
  for (const point of [first, later]) {
    const radius = Math.hypot(point.x - center.x, point.y - center.y);
    assert.ok(radius >= 96 && radius <= 104, `motion must stay close to the 100px ring (received ${radius})`);
  }
});

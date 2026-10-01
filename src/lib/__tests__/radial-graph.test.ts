import assert from "node:assert/strict";
import test from "node:test";
import { circularGraphLayout, linkedCircularLayout } from "../radial-graph";

test("circular graph layout keeps nodes on a circle with useful spacing", () => {
  const ids = Array.from({ length: 8 }, (_, index) => `node-${index}`);
  const positions = circularGraphLayout(ids, { width: 600, height: 400 });
  const radii = ids.map((id) => Math.hypot(positions[id].x - 300, positions[id].y - 200));
  assert.ok(Math.max(...radii) - Math.min(...radii) < 0.001);
  for (let index = 0; index < ids.length; index++) {
    const a = positions[ids[index]];
    const b = positions[ids[(index + 1) % ids.length]];
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 49);
  }
});

test("linked nodes form an evenly spaced ring around the dragged node", () => {
  const ids = ["anchor", "a", "b", "c", "d"];
  const base = circularGraphLayout(ids, { width: 600, height: 400 });
  const positions = linkedCircularLayout("anchor", ids.slice(1), { x: 300, y: 200 }, { width: 600, height: 400 }, base);
  const radii = ids.slice(1).map((id) => Math.hypot(positions[id].x - positions.anchor.x, positions[id].y - positions.anchor.y));
  assert.ok(Math.max(...radii) - Math.min(...radii) < 0.001);
  assert.ok(radii[0] >= 72);
});

test("a dense linked graph remains inside the canvas on concentric circles", () => {
  const linked = Array.from({ length: 60 }, (_, index) => `linked-${index}`);
  const ids = ["anchor", ...linked];
  const base = circularGraphLayout(ids, { width: 800, height: 480 });
  const positions = linkedCircularLayout("anchor", linked, { x: 25, y: 25 }, { width: 800, height: 480 }, base);
  for (const id of ids) {
    assert.ok(positions[id].x >= 17 && positions[id].x <= 783, `${id} x is in bounds`);
    assert.ok(positions[id].y >= 17 && positions[id].y <= 463, `${id} y is in bounds`);
  }
  const distinctRadii = new Set(linked.map((id) => Math.round(Math.hypot(positions[id].x - positions.anchor.x, positions[id].y - positions.anchor.y))));
  assert.ok(distinctRadii.size >= 3);
});

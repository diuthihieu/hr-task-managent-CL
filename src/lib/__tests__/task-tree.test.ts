import test from "node:test";
import assert from "node:assert/strict";
import { buildTaskTree } from "../task-tree";

const r = (id: string, parent?: string) => ({ id, data: parent ? { sys_parent: [parent] } : {} });
const shape = (rows: ReturnType<typeof buildTaskTree>) => rows.map((x) => `${"  ".repeat(x.depth)}${x.record.id}${x.childCount ? `(${x.childCount})` : ""}`);

test("children follow their parent, indented, keeping the list order among siblings", () => {
  const rows = buildTaskTree([r("b1", "b"), r("a"), r("b"), r("a1", "a"), r("a2", "a"), r("a1x", "a1")]);
  assert.deepEqual(shape(rows), ["a(2)", "  a1(1)", "    a1x", "  a2", "b(1)", "  b1"]);
});

test("a task whose parent is not in the list stays visible at the top level", () => {
  assert.deepEqual(shape(buildTaskTree([r("x", "missing"), r("y")])), ["x", "y"]);
});

test("collapsed tasks hide their descendants but keep the child count", () => {
  const rows = buildTaskTree([r("a"), r("a1", "a"), r("a1x", "a1"), r("b")], new Set(["a"]));
  assert.deepEqual(shape(rows), ["a(1)", "b"]);
});

test("cycles in bad data never loop or drop tasks", () => {
  const rows = buildTaskTree([r("p", "q"), r("q", "p"), r("self", "self")]);
  assert.deepEqual(rows.map((x) => x.record.id).sort(), ["p", "q", "self"]);
});

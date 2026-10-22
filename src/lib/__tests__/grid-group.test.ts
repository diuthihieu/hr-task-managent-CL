import test from "node:test";
import assert from "node:assert/strict";
import type { FieldRow } from "@/types";
import { EMPTY_GROUP_KEY, groupFieldPatch } from "../grid-group";

const field = (id: string, type: string, extra: Partial<FieldRow> = {}): FieldRow => ({
  id,
  projectId: "project",
  name: id,
  type,
  config: "{}",
  order: 0,
  isPrimary: false,
  visible: true,
  description: null,
  defaultValue: null,
  isRequired: false,
  ...extra,
});

test("a row inserted in a group takes that group's value, keeping its type", () => {
  assert.deepEqual(groupFieldPatch(field("sys_category", "single_select"), "cat-1", "cat-1"), { sys_category: "cat-1" });
  assert.deepEqual(groupFieldPatch(field("score", "number"), "3", 3), { score: 3 });
  assert.deepEqual(groupFieldPatch(field("done", "checkbox"), "false", false), { done: false });
});

test("multi-value fields get only the group's own value", () => {
  assert.deepEqual(groupFieldPatch(field("sys_assignees", "people"), "u2", ["u1", "u2"]), { sys_assignees: ["u2"] });
  assert.deepEqual(groupFieldPatch(field("tags", "multi_select"), "x", ["x"]), { tags: ["x"] });
});

test("the empty group clears the field, except status which every task has", () => {
  assert.deepEqual(groupFieldPatch(field("sys_category", "single_select"), EMPTY_GROUP_KEY, null), { sys_category: null });
  assert.deepEqual(groupFieldPatch(field("sys_assignees", "people"), EMPTY_GROUP_KEY, []), { sys_assignees: [] });
  assert.equal(groupFieldPatch(field("sys_status", "status"), EMPTY_GROUP_KEY, null), null);
});

test("computed, read-only and title fields are never written", () => {
  assert.equal(groupFieldPatch(field("sys_created_by", "created_by", { readOnly: true }), "u1", "u1"), null);
  assert.equal(groupFieldPatch(field("f", "formula"), "1", 1), null);
  assert.equal(groupFieldPatch(field("sys_title", "text", { isPrimary: true }), "A", "A"), null);
  assert.equal(groupFieldPatch(field("loc", "location"), "x", { address: "x" }), null);
});

test("a sample that does not match the group key writes nothing", () => {
  assert.equal(groupFieldPatch(field("sys_category", "single_select"), "cat-1", "cat-2"), null);
  assert.equal(groupFieldPatch(field("sys_assignees", "people"), "u9", ["u1"]), null);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { applyFilters, applyGroup, applySorts, getConditionalStyle } from "../query-engine";
import { field, record } from "./helpers";

const STATUS = [
  { id: "todo", label: "To Do", color: "#aaa" },
  { id: "done", label: "Done", color: "#0f0" },
];
const fields = [
  field("name", "Task", "text", undefined, { isPrimary: true }),
  field("status", "Status", "status", { options: STATUS }),
  field("hours", "Hours", "number"),
  field("owner", "Owner", "person"),
  field("double", "Double", "formula", { expression: "{Hours} * 2" }),
];
const records = [
  record("r1", { name: "Payroll run", status: "todo", hours: 5, owner: "u1" }, 0),
  record("r2", { name: "Onboarding pack", status: "done", hours: 2, owner: "u2" }, 1),
  record("r3", { name: "BHXH report", status: "todo", hours: 8, owner: "u1" }, 2),
];
const ids = (rs: { id: string }[]) => rs.map((r) => r.id);

test("AND filter combines conditions", () => {
  const out = applyFilters(records, fields, {
    conjunction: "AND",
    conditions: [
      { id: "c1", fieldId: "status", operator: "is", value: "todo" },
      { id: "c2", fieldId: "hours", operator: "gt", value: 6 },
    ],
  });
  assert.deepEqual(ids(out), ["r3"]);
});

test("OR filter matches any condition", () => {
  const out = applyFilters(records, fields, {
    conjunction: "OR",
    conditions: [
      { id: "c1", fieldId: "status", operator: "is", value: "done" },
      { id: "c2", fieldId: "name", operator: "contains", value: "bhxh" },
    ],
  });
  assert.deepEqual(ids(out), ["r2", "r3"]);
});

test("is_current_user filter", () => {
  const out = applyFilters(records, fields, { conjunction: "AND", conditions: [{ id: "c", fieldId: "owner", operator: "is_current_user" }] }, "u2");
  assert.deepEqual(ids(out), ["r2"]);
});

test("filters can target formula fields", () => {
  const out = applyFilters(records, fields, { conjunction: "AND", conditions: [{ id: "c", fieldId: "double", operator: "gte", value: 10 }] });
  assert.deepEqual(ids(out), ["r1", "r3"]);
});

test("empty filter group returns all records", () => {
  assert.equal(applyFilters(records, fields, { conjunction: "AND", conditions: [] }).length, 3);
});

test("sorts numerically and falls back to manual order", () => {
  assert.deepEqual(ids(applySorts(records, fields, [{ fieldId: "hours", direction: "desc" }])), ["r3", "r1", "r2"]);
  assert.deepEqual(ids(applySorts([...records].reverse(), fields, undefined)), ["r1", "r2", "r3"]);
});

test("groups by option label with sum aggregate", () => {
  const groups = applyGroup(records, fields, { fieldId: "status", aggFieldId: "hours", aggFn: "sum" })!;
  assert.deepEqual(
    groups.map((g) => [g.label, g.records.length, g.aggregate]),
    [
      ["Done", 1, 2],
      ["To Do", 2, 13],
    ]
  );
});

test("conditional formatting colors row or a single cell", () => {
  const rules = [
    { id: "a", fieldId: "hours", operator: "gt" as const, value: 6, target: "row" as const, color: "red" },
    { id: "b", fieldId: "status", operator: "is" as const, value: "done", target: "cell" as const, color: "green" },
  ];
  assert.equal(getConditionalStyle(records[2], fields, rules, "name").rowColor, "red");
  assert.equal(getConditionalStyle(records[1], fields, rules, "status").backgroundColor, "green");
  assert.equal(getConditionalStyle(records[1], fields, rules, "name").backgroundColor, undefined);
});

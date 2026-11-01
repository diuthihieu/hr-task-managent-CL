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

test("sub-tasks are grouped with their top-most parent in the list, whatever their own value", () => {
  const rs = [
    record("p", { name: "Parent", status: "todo" }, 0),
    record("c", { name: "Child", status: "done", sys_parent: ["p"] }, 1),
    record("g", { name: "Grandchild", status: "done", sys_parent: ["c"] }, 2),
    record("o", { name: "Orphan", status: "done", sys_parent: ["missing"] }, 3),
  ];
  const groups = applyGroup(rs, fields, { fieldId: "status" })!;
  assert.deepEqual(groups.map((g) => [g.label, ids(g.records)]), [
    ["Done", ["o"]],
    ["To Do", ["p", "c", "g"]],
  ]);
});

test("'is' on assignees matches tasks shared with others (U2)", async () => {
  const { applyFilters } = await import("../query-engine");
  const { field, record } = await import("./helpers");
  const people = field("sys_assignees", "Assignees", "people");
  const rows = [record("hieu", { sys_assignees: ["u-hieu"] }), record("both", { sys_assignees: ["u-hieu", "u-tam"] }), record("tam", { sys_assignees: ["u-tam"] }), record("none", { sys_assignees: [] })];
  const ids = (op: "is" | "is_not", value: unknown) => applyFilters(rows, [people], { conjunction: "AND", conditions: [{ id: "c", fieldId: "sys_assignees", operator: op, value }] }).map((r) => r.id);
  assert.deepEqual(ids("is", "u-hieu"), ["hieu", "both"]);
  assert.deepEqual(ids("is_not", "u-hieu"), ["tam", "none"]);
  assert.deepEqual(ids("is", ["u-hieu", "u-tam"]), ["hieu", "both", "tam"]);
});

test("AND and OR combine through condition groups (U4)", async () => {
  const { applyFilters, filterConditionCount } = await import("../query-engine");
  const { field, record } = await import("./helpers");
  const fields = [field("sys_status", "Status", "status"), field("sys_assignees", "Assignees", "people")];
  const rows = [
    record("hieu-todo", { sys_status: "todo", sys_assignees: ["hieu"] }),
    record("hieu-doing", { sys_status: "doing", sys_assignees: ["hieu", "tam"] }),
    record("hieu-done", { sys_status: "done", sys_assignees: ["hieu"] }),
    record("tam-todo", { sys_status: "todo", sys_assignees: ["tam"] }),
  ];
  const filter = {
    conjunction: "AND" as const,
    conditions: [{ id: "a", fieldId: "sys_assignees", operator: "is" as const, value: "hieu" }],
    groups: [{ conjunction: "OR" as const, conditions: [{ id: "s1", fieldId: "sys_status", operator: "is" as const, value: "todo" }, { id: "s2", fieldId: "sys_status", operator: "is" as const, value: "doing" }] }],
  };
  assert.deepEqual(applyFilters(rows, fields, filter).map((r) => r.id), ["hieu-todo", "hieu-doing"], "Hieu AND (To do OR Doing)");
  assert.equal(filterConditionCount(filter), 3);
  // OR at the top with an AND group: done tasks, or Tam's to-dos.
  const or = { conjunction: "OR" as const, conditions: [{ id: "d", fieldId: "sys_status", operator: "is" as const, value: "done" }], groups: [{ conjunction: "AND" as const, conditions: [{ id: "t", fieldId: "sys_assignees", operator: "is" as const, value: "tam" }, { id: "td", fieldId: "sys_status", operator: "is" as const, value: "todo" }] }] };
  assert.deepEqual(applyFilters(rows, fields, or).map((r) => r.id), ["hieu-done", "tam-todo"]);
  // An empty group doesn't turn an OR into "everything".
  assert.deepEqual(applyFilters(rows, fields, { ...or, groups: [{ conjunction: "AND", conditions: [] }] }).map((r) => r.id), ["hieu-done"]);
});

test("dashboard filters keep a chart's OR when merged with slicers", async () => {
  const { mergeFilters } = await import("../dashboard-engine");
  const { applyFilters } = await import("../query-engine");
  const { field, record } = await import("./helpers");
  const fields = [field("sys_status", "Status", "status"), field("sys_priority", "Priority", "single_select")];
  const rows = [record("a", { sys_status: "todo", sys_priority: "high" }), record("b", { sys_status: "doing", sys_priority: "high" }), record("c", { sys_status: "done", sys_priority: "high" }), record("d", { sys_status: "todo", sys_priority: "low" })];
  const chart = { conjunction: "OR" as const, conditions: [{ id: "1", fieldId: "sys_status", operator: "is" as const, value: "todo" }, { id: "2", fieldId: "sys_status", operator: "is" as const, value: "doing" }] };
  const slicer = { conjunction: "AND" as const, conditions: [{ id: "3", fieldId: "sys_priority", operator: "is" as const, value: "high" }] };
  assert.deepEqual(applyFilters(rows, fields, mergeFilters(undefined, chart, slicer)).map((r) => r.id), ["a", "b"]);
});

test("multi-level grouping: the first group is the parent, the next ones nest inside (U5)", async () => {
  const { applyGroup, leafGroups } = await import("../query-engine");
  const { field, record } = await import("./helpers");
  const fields = [field("sys_category", "Category", "text"), field("sys_assignees", "Assignees", "people"), field("sys_actual", "Actual", "number")];
  const rows = [
    record("1", { sys_category: "Payroll", sys_assignees: ["hieu"], sys_actual: 2 }),
    record("2", { sys_category: "Payroll", sys_assignees: ["hieu", "tam"], sys_actual: 3 }),
    record("3", { sys_category: "Recruit", sys_assignees: ["tam"], sys_actual: 4 }),
  ];
  const rule = { fieldId: "sys_category", thenFieldIds: ["sys_assignees"], aggFn: "sum" as const, aggFieldId: "sys_actual" };
  const groups = applyGroup(rows, fields, rule)!;
  assert.deepEqual(groups.map((g) => [g.label, g.records.length, g.aggregate]), [["Payroll", 2, 5], ["Recruit", 1, 4]]);
  assert.deepEqual(groups[0].children!.map((g) => [g.key, g.records.map((r) => r.id), g.aggregate]), [["hieu", ["1", "2"], 5], ["tam", ["2"], 3]]);
  const leaves = leafGroups(groups, rule);
  assert.deepEqual(leaves.map((l) => [l.key.split("\u0001"), l.path.map((p) => p.fieldId)]), [
    [["Payroll", "hieu"], ["sys_category", "sys_assignees"]],
    [["Payroll", "tam"], ["sys_category", "sys_assignees"]],
    [["Recruit", "tam"], ["sys_category", "sys_assignees"]],
  ]);
  assert.equal(leaves[0].path[0].count, 2, "the parent level knows its size");
  assert.deepEqual(leafGroups(applyGroup(rows, fields, { fieldId: "sys_category" })!, { fieldId: "sys_category" }).map((l) => l.key), ["Payroll", "Recruit"], "one level: same keys as before");
});

test("multi-level grouping: a level whose field was deleted is skipped, and each leaf keeps the real field of every level", async () => {
  const { applyGroup, leafGroups } = await import("../query-engine");
  const { field, record } = await import("./helpers");
  const fields = [field("sys_category", "Category", "text"), field("sys_assignees", "Assignees", "people")];
  const rows = [record("1", { sys_category: "Payroll", sys_assignees: ["hieu"] })];
  // Saved as Category -> (deleted field) -> Assignees.
  const rule = { fieldId: "sys_category", thenFieldIds: ["cf_deleted", "sys_assignees"] };
  const leaves = leafGroups(applyGroup(rows, fields, rule)!, rule);
  assert.deepEqual(leaves.map((l) => l.path.map((p) => [p.fieldId, p.key])), [[["sys_category", "Payroll"], ["sys_assignees", "hieu"]]]);
});

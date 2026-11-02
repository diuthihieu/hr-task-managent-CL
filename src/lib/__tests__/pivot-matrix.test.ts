import { test } from "node:test";
import assert from "node:assert/strict";
import { field, record } from "./helpers";
import { computeMatrix, matrixRowsForExport, type MatrixNode } from "../pivot-matrix";

// D4: the summary table as a Power BI-like matrix - several row and column fields (the first is the
// parent), subtotals at every level, levels the viewer can hide, and an export of what is shown.
const cat = field("sys_category", "Category", "single_select", { options: [{ id: "pay", label: "Payroll" }, { id: "rec", label: "Recruit" }] });
const people = field("sys_assignees", "Assignees", "people");
const status = field("sys_status", "Status", "status", { options: [{ id: "todo", label: "To do" }, { id: "done", label: "Done" }] });
const prio = field("sys_priority", "Priority", "single_select", { options: [{ id: "hi", label: "High" }, { id: "lo", label: "Low" }] });
const actual = field("sys_actual", "Actual", "number");
const parent = field("sys_parent", "Parent", "link");
const fields = [cat, people, status, prio, actual, parent];
const members = [{ id: "a", name: "An", avatarColor: "#111" }, { id: "b", name: "Binh", avatarColor: "#222" }];
const rows = [
  record("t1", { sys_category: "pay", sys_assignees: ["a", "b"], sys_status: "done", sys_priority: "hi", sys_actual: 6, sys_parent: [] }),
  record("t2", { sys_category: "pay", sys_assignees: ["a"], sys_status: "todo", sys_priority: "lo", sys_actual: 2, sys_parent: [] }),
  record("t3", { sys_category: "rec", sys_assignees: ["b"], sys_status: "done", sys_priority: "lo", sys_actual: 4, sys_parent: [] }),
];
const sum = { measureFieldId: "sys_actual", aggregation: "sum" as const };
const find = (nodes: MatrixNode[], ...labels: string[]): MatrixNode => {
  const n = nodes.find((x) => x.label === labels[0])!;
  return labels.length > 1 ? find(n.children ?? [], ...labels.slice(1)) : n;
};

test("rows by Category then Assignee: children under their parent, subtotals add the children up (person-hours)", () => {
  const m = computeMatrix(rows, fields, { ...sum, rowFieldIds: ["sys_category", "sys_assignees"] }, members);
  assert.deepEqual(m.rowFields, ["Category", "Assignees"]);
  assert.deepEqual(m.rows.map((r) => r.label), ["Payroll", "Recruit"]);
  assert.deepEqual(find(m.rows, "Payroll").children!.map((c) => [c.label, c.total]), [["An", 8], ["Binh", 6]]);
  assert.equal(find(m.rows, "Payroll").total, 14, "An 8 + Binh 6 - each person in full, as the single-level table");
  assert.equal(find(m.rows, "Recruit", "Binh").total, 4);
  assert.equal(m.total, 18);
});

test("columns by Status then Priority: nested headers with a subtotal column per parent group", () => {
  const m = computeMatrix(rows, fields, { ...sum, rowFieldIds: ["sys_category"], colFieldIds: ["sys_status", "sys_priority"] }, members);
  assert.deepEqual(m.columns.map((c) => [c.labels.join(" › "), c.subtotal]), [
    ["Done › High", false],
    ["Done › Low", false],
    ["Done", true],
    ["To do › Low", false],
    ["To do", true],
  ]);
  assert.deepEqual(find(m.rows, "Payroll").values, [6, 0, 6, 2, 2]);
  assert.deepEqual(find(m.rows, "Recruit").values, [0, 4, 4, 0, 0]);
  assert.deepEqual(m.totals, [6, 4, 10, 2, 2]);
  assert.equal(m.total, 12);
});

test("the viewer hides a level: numbers are worked out again without it", () => {
  const m = computeMatrix(rows, fields, { ...sum, rowFieldIds: ["sys_category", "sys_assignees"], colFieldIds: ["sys_status", "sys_priority"] }, members, undefined, { rows: ["sys_assignees"], cols: ["sys_status"] });
  assert.deepEqual(m.rowFields, ["Assignees"]);
  assert.deepEqual(m.rows.map((r) => [r.label, r.total, r.children]), [["An", 8, undefined], ["Binh", 10, undefined]]);
  assert.deepEqual(m.columns.map((c) => c.labels.join(" › ")), ["Done", "To do"]);
  const none = computeMatrix(rows, fields, { ...sum, rowFieldIds: ["sys_category"] }, members, undefined, { rows: ["gone"], cols: [] });
  assert.deepEqual(none.rowFields, ["Category"], "at least one row level stays");
});

test("an average subtotal is the average of its tasks, not of its children's averages", () => {
  const m = computeMatrix(rows, fields, { measureFieldId: "sys_actual", aggregation: "avg", rowFieldIds: ["sys_category", "sys_priority"] }, members);
  assert.deepEqual(find(m.rows, "Payroll").children!.map((c) => [c.label, c.total]), [["High", 6], ["Low", 2]]);
  assert.equal(find(m.rows, "Payroll").total, 4);
  assert.equal(m.total, 4, "(6 + 2 + 4) / 3");
});

test("legacy one-row / one-column config still works (dimensionFieldId / dimension2FieldId)", () => {
  const m = computeMatrix(rows, fields, { ...sum, dimensionFieldId: "sys_assignees", dimension2FieldId: "sys_category" }, members);
  assert.deepEqual([m.rowFields, m.colFields], [["Assignees"], ["Category"]]);
  assert.deepEqual(m.rows.map((r) => [r.label, r.values, r.total]), [["An", [8, 0], 8], ["Binh", [6, 4], 10]]);
});

test("export: one column per row level, the rows shown (collapsed parents without children), headers joined", () => {
  const m = computeMatrix(rows, fields, { ...sum, rowFieldIds: ["sys_category", "sys_assignees"], colFieldIds: ["sys_status"] }, members);
  const out = matrixRowsForExport(m, new Set([m.rows.find((r) => r.label === "Recruit")!.path]), "Total");
  assert.deepEqual(out, [
    ["Category", "Assignees", "Done", "To do", "Total"],
    ["Payroll", "", 12, 2, 14],
    ["Payroll", "An", 6, 2, 8],
    ["Payroll", "Binh", 6, 0, 6],
    ["Recruit", "", 4, 0, 4],
    ["Total", "", 16, 2, 18],
  ]);
});

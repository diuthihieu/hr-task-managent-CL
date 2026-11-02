import { test } from "node:test";
import assert from "node:assert/strict";
import { field, record } from "./helpers";
import { MAX_SLICER_VALUES, addSlicerValues, mergeSlicerOptions, normalizeSlicer, slicerActive, slicerConditions, slicerOptions, type SlicerSelection } from "../dashboard-slicers";
import { applyFilters } from "../query-engine";

// D3: Power BI-like slicers - OR between the values of one slicer, AND between slicers, an empty
// slicer filters nothing, date ranges include both ends, options follow the other slicers.
const status = field("sys_status", "Status", "single_select", { options: [{ id: "todo", label: "To do" }, { id: "doing", label: "In progress" }, { id: "done", label: "Done" }] });
const people = field("sys_assignees", "Assignees", "people");
const due = field("sys_due_date", "Due date", "date");
const fields = [status, people, due];
const members = [{ id: "a", name: "An", avatarColor: "#111" }, { id: "b", name: "Binh", avatarColor: "#222" }];
const rows = [
  record("t1", { sys_status: "todo", sys_assignees: ["a"], sys_due_date: "2026-10-01" }),
  record("t2", { sys_status: "doing", sys_assignees: ["a", "b"], sys_due_date: "2026-10-15" }),
  record("t3", { sys_status: "done", sys_assignees: ["b"], sys_due_date: "2026-10-31" }),
  record("t4", { sys_status: "done", sys_assignees: [], sys_due_date: null }),
];
const ids = (slicers: SlicerSelection[]) => applyFilters(rows, fields, { conjunction: "AND", conditions: slicerConditions(rows, fields, members, slicers) }).map((r) => r.id);

test("one slicer: values are ORed; nothing selected filters nothing", () => {
  assert.deepEqual(ids([{ fieldName: "Status", values: ["To do", "Done"] }]), ["t1", "t3", "t4"]);
  assert.deepEqual(ids([{ fieldName: "Status", values: [] }]), ["t1", "t2", "t3", "t4"]);
  assert.equal(slicerActive({ fieldName: "Status", values: [] }), false);
  assert.deepEqual(ids([{ fieldName: "status", values: ["done"] }]), ["t3", "t4"], "field name and value match ignoring case");
});

test("several slicers are ANDed; a multi-person task matches each of its people", () => {
  assert.deepEqual(ids([{ fieldName: "Status", values: ["In progress", "Done"] }, { fieldName: "Assignees", values: ["Binh"] }]), ["t2", "t3"]);
  assert.deepEqual(ids([{ fieldName: "Assignees", values: ["(Empty)"] }]), ["t4"], "(Empty) picks tasks with no value");
});

test("a selection with no data gives no rows (it isn't dropped), and a slicer on a field this source lacks doesn't apply", () => {
  assert.deepEqual(ids([{ fieldName: "Status", values: ["Done"] }, { fieldName: "Assignees", values: ["An"] }]), [], "Done AND An: no task - empty, not unfiltered");
  assert.deepEqual(ids([{ fieldName: "Status", values: ["Archived"] }]), [], "a value this data doesn't have matches nothing");
  assert.deepEqual(ids([{ fieldName: "Department", values: ["HR"] }]), ["t1", "t2", "t3", "t4"]);
});

test("date slicer: a range including both ends, either end optional", () => {
  assert.deepEqual(ids([{ fieldName: "Due date", from: "2026-10-01", to: "2026-10-15" }]), ["t1", "t2"]);
  assert.deepEqual(ids([{ fieldName: "Due date", from: "2026-10-15" }]), ["t2", "t3"]);
  assert.deepEqual(ids([{ fieldName: "Due date", to: "2026-10-01" }]), ["t1"]);
});

test("options: values with counts after the other slicers; the slicer's own selection is kept even with no data", () => {
  const all = slicerOptions(rows, fields, members, { fieldName: "Status" }, []);
  assert.deepEqual(mergeSlicerOptions([all, slicerOptions(rows, fields, members, { fieldName: "Status" }, [])]).values, all.values, "the same tasks read by two widgets count once");
  assert.deepEqual(all.values, [{ label: "Done", count: 2 }, { label: "In progress", count: 1 }, { label: "To do", count: 1 }]);
  const forBinh = slicerOptions(rows, fields, members, { fieldName: "Status" }, [{ fieldName: "Assignees", values: ["Binh"] }, { fieldName: "Status", values: ["To do"] }]);
  assert.deepEqual(forBinh.values, [{ label: "Done", count: 1 }, { label: "In progress", count: 1 }], "linked to the Assignees slicer, not narrowed by its own selection");
  assert.equal(forBinh.kind, "list");
  const dates = slicerOptions(rows, fields, members, { fieldName: "Due date" }, []);
  assert.deepEqual([dates.kind, dates.min, dates.max], ["date", "2026-10-01", "2026-10-31"]);
  assert.equal(slicerOptions(rows, fields, members, { fieldName: "Nope" }, []).found, false);
});

test("an old saved slicer picking one date still filters that day", () => {
  const legacy = normalizeSlicer({ fieldName: "Due date", label: "2026-10-15", operator: "is" })!;
  assert.deepEqual(ids([legacy]), ["t2"]);
  assert.deepEqual(ids([{ fieldName: "Due date", values: ["2026-10-01", "2026-10-31T10:00:00.000Z"] }]), ["t1", "t3"], "several days: any of them");
});

test("old saved slicers (one value / before / after / between) still work", () => {
  assert.deepEqual(normalizeSlicer({ fieldName: "Status", label: "Done", operator: "is" }), { fieldName: "Status", values: ["Done"] });
  assert.deepEqual(normalizeSlicer({ fieldName: "Due", label: "2026-10-01", operator: "between", value2: "2026-10-31" }), { fieldName: "Due", from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(normalizeSlicer({ fieldName: "Due", label: "2026-10-01", operator: "after" }), { fieldName: "Due", from: "2026-10-02" });
  assert.deepEqual(normalizeSlicer({ fieldName: "Due", label: "2026-10-01", operator: "before" }), { fieldName: "Due", to: "2026-09-30" });
  assert.equal(normalizeSlicer({ fieldName: "" }), null);
  assert.equal(normalizeSlicer({ fieldName: "Status", values: Array.from({ length: 600 }, (_, i) => `v${i}`) })?.values?.length, MAX_SLICER_VALUES, "bounded - the UI never picks more (MAX_SLICER_VALUES)");
});

test("a built-in field is found by its name in either language (the UI shows it translated)", () => {
  const sys = [field("sys_due_date", "Due date", "date", undefined, { system: true }), field("sys_category", "Category", "single_select", { options: [{ id: "pay", label: "Payroll" }] }, { system: true })];
  const r = [record("x", { sys_due_date: "2026-10-01", sys_category: "pay" }), record("y", { sys_due_date: "2026-11-01", sys_category: null })];
  const kept = (s: SlicerSelection[]) => applyFilters(r, sys, { conjunction: "AND", conditions: slicerConditions(r, sys, members, s) }).map((x) => x.id);
  assert.deepEqual(kept([{ fieldName: "Hạn chót", to: "2026-10-31" }]), ["x"]);
  assert.equal(slicerOptions(r, sys, members, { fieldName: "hạn chót" }, [{ fieldName: "Due date", from: "2026-11-01" }]).min, "2026-10-01", "its own selection, named in the other language, doesn't narrow it");
});

test("picking values never goes past the limit, and says when it stops (Select all on a long list)", () => {
  const many = Array.from({ length: 700 }, (_, i) => `v${i}`);
  const r = addSlicerValues(["v0"], many);
  assert.equal(r.values.length, MAX_SLICER_VALUES);
  assert.equal(r.capped, true);
  assert.deepEqual(addSlicerValues(["A"], ["a", "B"]), { values: ["A", "B"], capped: false }, "case ignored, no duplicates");
  assert.equal(normalizeSlicer({ fieldName: "x", values: r.values })?.values?.length, r.values.length, "what is ticked is exactly what the server filters by");
});

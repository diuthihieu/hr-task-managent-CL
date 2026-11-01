import assert from "node:assert/strict";
import test from "node:test";
import { computeKpiTrend, type DashboardBlockConfig } from "../dashboard-engine";
import type { FieldRow, RecordRow } from "@/types";
import { field } from "./helpers";

const fields: FieldRow[] = [
  { id: "created", projectId: "p", name: "Created", type: "created_time", config: null, order: 0, isPrimary: false, visible: true, description: null, defaultValue: null },
  { id: "amount", projectId: "p", name: "Amount", type: "number", config: null, order: 1, isPrimary: false, visible: true, description: null, defaultValue: null },
];

function record(id: string, createdAt: string, amount: number): RecordRow {
  return { id, projectId: "p", data: { amount }, order: 0, createdById: null, createdAt, updatedAt: createdAt };
}

test("KPI trend compares current and immediately previous calendar month", () => {
  const records = [record("1", "2026-08-12T00:00:00.000Z", 30), record("2", "2026-09-03T00:00:00.000Z", 40), record("3", "2026-09-20T00:00:00.000Z", 20)];
  const config: DashboardBlockConfig = { measureFieldId: "amount", aggregation: "sum", kpiCompareTo: "previous_month", kpiDateFieldId: "created" };
  const trend = computeKpiTrend(records, fields, config, undefined, new Date("2026-09-29T12:00:00.000Z"));
  assert.deepEqual(trend, { current: 60, previous: 30, delta: 30, percentChange: 100, direction: "up", period: "previous_month" });
});

test("KPI trend reports an undefined percentage when the prior period is zero", () => {
  const trend = computeKpiTrend([record("1", "2026-09-03T00:00:00.000Z", 5)], fields, { measureFieldId: "amount", aggregation: "sum", kpiCompareTo: "previous_month", kpiDateFieldId: "created" }, undefined, new Date("2026-09-29T12:00:00.000Z"));
  assert.equal(trend?.previous, 0);
  assert.equal(trend?.percentChange, null);
  assert.equal(trend?.direction, "up");
});

test("a sum / average without a value field is reported, not shown as 0 (U1)", async () => {
  const { widgetConfigProblem } = await import("../dashboard-engine");
  const fields = [field("sys_actual", "Actual (h)", "number"), field("sys_category", "Category", "single_select")];
  assert.match(widgetConfigProblem("column", { aggregation: "sum", dimensionFieldId: "sys_category" }, fields) ?? "", /value field/);
  assert.match(widgetConfigProblem("kpi", { aggregation: "avg", measureFieldId: "gone" }, fields) ?? "", /value field/);
  assert.match(widgetConfigProblem("pie", { aggregation: "count", dimensionFieldId: "gone" }, fields) ?? "", /no longer exists/);
  assert.equal(widgetConfigProblem("column", { aggregation: "sum", measureFieldId: "sys_actual", dimensionFieldId: "sys_category" }, fields), null);
  assert.equal(widgetConfigProblem("kpi", { aggregation: "count" }, fields), null);
});

test("pivot table: hours by assignee x category, each assignee in full, parents only their own share (U8)", async () => {
  const { computePivot } = await import("../dashboard-engine");
  const { record: rec } = await import("./helpers");
  const fields = [field("sys_assignees", "Assignees", "people"), field("sys_category", "Category", "single_select", { options: [{ id: "pay", label: "Payroll", color: "#f00" }, { id: "rec", label: "Recruit", color: "#0f0" }] }), field("sys_actual", "Actual (h)", "number"), field("sys_parent", "Parent", "link")];
  const members = [{ id: "a", name: "An", avatarColor: "#111" }, { id: "b", name: "Binh", avatarColor: "#222" }];
  const rows = [
    rec("shared", { sys_assignees: ["a", "b"], sys_category: "pay", sys_actual: 6, sys_parent: [] }),
    rec("parent", { sys_assignees: ["a"], sys_category: "rec", sys_actual: 5, sys_parent: [] }),
    rec("child", { sys_assignees: ["a"], sys_category: "rec", sys_actual: 2, sys_parent: ["parent"] }),
    rec("none", { sys_assignees: [], sys_category: "pay", sys_actual: 1, sys_parent: [] }),
  ];
  const p = computePivot(rows, fields, { dimensionFieldId: "sys_assignees", dimension2FieldId: "sys_category", measureFieldId: "sys_actual", aggregation: "sum" }, members);
  assert.deepEqual(p.cols.map((c) => c.label), ["Payroll", "Recruit"]);
  assert.deepEqual(p.rows.map((r) => r.label), ["An", "Binh", "(Empty)"]);
  assert.deepEqual(p.cells, [[6, 5], [6, 0], [1, 0]], "An: 6 shared + 3 own parent + 2 child = 11; Binh 6 in full");
  assert.deepEqual(p.rowTotals, [11, 6, 1]);
  assert.deepEqual(p.colTotals, [13, 5]);
  assert.equal(p.total, 18, "person-hours");
  const counts = computePivot(rows, fields, { dimensionFieldId: "sys_category", aggregation: "count" }, members);
  assert.deepEqual([counts.rows.map((r) => r.label), counts.cols.map((c) => c.label), counts.cells], [["Payroll", "Recruit"], ["Value"], [[2], [2]]]);
});

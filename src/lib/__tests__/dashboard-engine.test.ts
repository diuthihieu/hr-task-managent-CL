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

test("pivot table: a filter that drops a sub-task doesn't hand its hours to the parent (own share from all tasks)", async () => {
  const { computePivot } = await import("../dashboard-engine");
  const { record: rec } = await import("./helpers");
  const fields = [field("sys_assignees", "Assignees", "people"), field("sys_actual", "Actual (h)", "number"), field("sys_parent", "Parent", "link")];
  const members = [{ id: "a", name: "An", avatarColor: "#111" }, { id: "b", name: "Binh", avatarColor: "#222" }];
  const rows = [rec("parent", { sys_assignees: ["a"], sys_actual: 5, sys_parent: [] }), rec("child", { sys_assignees: ["b"], sys_actual: 2, sys_parent: ["parent"] })];
  const onlyAn = { conjunction: "AND" as const, conditions: [{ id: "f", fieldId: "sys_assignees", operator: "is" as const, value: "a" }] };
  const p = computePivot(rows, fields, { dimensionFieldId: "sys_assignees", measureFieldId: "sys_actual", aggregation: "sum", filters: onlyAn }, members);
  assert.deepEqual([p.rows.map((r) => r.label), p.cells], [["An"], [[3]]], "5 h parent - 2 h sub-task (filtered out) = 3 h, as without the filter");
});

test("pivot table: date rows follow the chosen bucket (month)", async () => {
  const { computePivot } = await import("../dashboard-engine");
  const { record: rec } = await import("./helpers");
  const fields = [field("sys_due_date", "Due", "date"), field("sys_actual", "Actual (h)", "number")];
  const rows = [rec("1", { sys_due_date: "2026-10-03", sys_actual: 1 }), rec("2", { sys_due_date: "2026-10-20", sys_actual: 2 }), rec("3", { sys_due_date: "2026-11-02", sys_actual: 4 })];
  const p = computePivot(rows, fields, { dimensionFieldId: "sys_due_date", measureFieldId: "sys_actual", aggregation: "sum", dateBucket: "month" }, []);
  assert.deepEqual([p.rows.map((r) => [r.key, r.label]), p.cells], [[["2026-10", "2026-10"], ["2026-11", "2026-11"]], [[3], [4]]]);
});

test("KPI and charts summing hours count a parent only for its own share, under filters too (no double counting)", async () => {
  const { computeKpi, computeSeries, computeStackedSeries, computeKpiTrend } = await import("../dashboard-engine");
  const { record: rec } = await import("./helpers");
  const fields = [
    field("sys_assignees", "Assignees", "people"),
    field("sys_category", "Category", "single_select", { options: [{ id: "pay", label: "Payroll", color: "#f00" }] }),
    field("sys_actual", "Actual (h)", "number"),
    field("sys_estimate", "Estimate (h)", "number"),
    field("sys_parent", "Parent", "link"),
    field("sys_due_date", "Due", "date"),
  ];
  const members = [{ id: "a", name: "An", avatarColor: "#111" }, { id: "b", name: "Binh", avatarColor: "#222" }];
  const rows = [
    rec("parent", { sys_assignees: ["a"], sys_category: "pay", sys_actual: 5, sys_estimate: 8, sys_parent: [], sys_due_date: "2026-10-10" }),
    rec("child", { sys_assignees: ["b"], sys_category: "pay", sys_actual: 2, sys_estimate: 3, sys_parent: ["parent"], sys_due_date: "2026-10-12" }),
  ];
  const sum = (measureFieldId: string, extra: Partial<DashboardBlockConfig> = {}) => ({ measureFieldId, aggregation: "sum" as const, ...extra });
  assert.equal(computeKpi(rows, fields, sum("sys_actual")), 5, "3 own + 2 child, not 5 + 2");
  assert.equal(computeKpi(rows, fields, sum("sys_estimate")), 8);
  const onlyAn = { conjunction: "AND" as const, conditions: [{ id: "f", fieldId: "sys_assignees", operator: "is" as const, value: "a" }] };
  assert.equal(computeKpi(rows, fields, sum("sys_actual", { filters: onlyAn })), 3, "a filtered-out sub-task doesn't hand its hours to the parent");
  assert.deepEqual(computeSeries(rows, fields, sum("sys_actual", { dimensionFieldId: "sys_category" }), members).map((p) => p.value), [5]);
  assert.deepEqual(computeSeries(rows, fields, sum("sys_actual", { dimensionFieldId: "sys_assignees", measure2FieldId: "sys_estimate" }), members).map((p) => [p.label, p.value, p.value2]), [["An", 3, 5], ["Binh", 2, 3]]);
  assert.equal(computeSeries(rows, fields, sum("sys_actual"), members)[0].value, 5, "a chart without a grouping field too");
  assert.deepEqual(computeStackedSeries(rows, fields, sum("sys_actual", { dimensionFieldId: "sys_category", dimension2FieldId: "sys_assignees" }), members).rows[0], { __rowKey: "pay", label: "Payroll", a: 3, b: 2 });
  const trend = computeKpiTrend(rows, fields, sum("sys_actual", { kpiCompareTo: "previous_month", kpiDateFieldId: "sys_due_date" }), undefined, new Date("2026-10-20T00:00:00Z"));
  assert.equal(trend?.current, 5);
  assert.equal(computeKpi(rows, fields, { measureFieldId: "sys_actual", aggregation: "max" }), 5, "other aggregations read the task's own value, as before");
});

test("a chart click on a built-in field filters other widgets whatever language names it", async () => {
  const { resolveCrossFilterCondition } = await import("../dashboard-engine");
  const status = field("sys_category", "Category", "single_select", { options: [{ id: "pay", label: "Payroll" }] }, { system: true });
  const due = field("sys_due_date", "Due Date", "date", undefined, { system: true });
  assert.equal(resolveCrossFilterCondition([status, due], [], { fieldName: "Hạn chót", label: "2026-10-01", operator: "after" })?.fieldId, "sys_due_date");
  assert.equal(resolveCrossFilterCondition([status], [], { fieldName: "category", label: "Payroll" })?.value, "pay");
});

test("summary table level fields are only checked on summary tables (a chart made from one isn't blocked)", async () => {
  const { widgetConfigProblem } = await import("../dashboard-engine");
  const fields = [field("sys_category", "Category", "single_select")];
  assert.equal(widgetConfigProblem("bar", { dimensionFieldId: "sys_category", rowFieldIds: ["gone"], colFieldIds: ["gone2"] }, fields), null);
  assert.match(widgetConfigProblem("pivot", { dimensionFieldId: "sys_category", rowFieldIds: ["sys_category", "gone"] }, fields) ?? "", /no longer exists/);
});

test("table header style: colours, wrapping and column widths are kept and bounded", async () => {
  const { normalizeWidgetStyle } = await import("../dashboard-engine");
  const s = normalizeWidgetStyle({ headerBackground: "#1e3a8a", headerTextColor: "#ffffff", headerWrap: false, columnWidths: { __rows: 220, "Done": 30, "x": 9999, bad: "wide" } })!;
  assert.deepEqual([s.headerBackground, s.headerTextColor, s.headerWrap], ["#1e3a8a", "#ffffff", false]);
  assert.deepEqual(s.columnWidths, { __rows: 220, Done: 48, x: 800 }, "widths clamped to 48-800 px, junk dropped");
  const d = normalizeWidgetStyle({ headerBackground: "red; background:url(x)" })!;
  assert.equal(d.headerBackground, undefined, "only #hex colours");
  assert.equal(d.headerWrap, true, "headers wrap by default");
  assert.equal(Object.keys(normalizeWidgetStyle({ columnWidths: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`c${i}`, 100])) })!.columnWidths ?? {}).length, 100, "at most 100 widths");
});

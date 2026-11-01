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

import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtChartNumber } from "./chart-format";

test("chart numbers: at most 2 decimals, thousands separated, text kept", () => {
  assert.equal(fmtChartNumber(92.8999999999999), "92.9");
  assert.equal(fmtChartNumber(192.5), "192.5");
  assert.equal(fmtChartNumber(115), "115");
  assert.equal(fmtChartNumber(0.1 + 0.2), "0.3");
  assert.equal(fmtChartNumber(1234.567), "1,234.57");
  assert.equal(fmtChartNumber("46.75"), "46.75");
  assert.equal(fmtChartNumber("Hieu"), "Hieu");
  assert.equal(fmtChartNumber(null), "");
  assert.equal(fmtChartNumber(Number.NaN), "");
});

import assert from "node:assert/strict";
import test from "node:test";
import { isDateOnly, objectivePeriod, overlaps, parseQuarterLabel, parseYearLabel, quarterPeriod, rangeParams, yearPeriod } from "../okr-period";

test("quarter and year periods cover whole calendar months", () => {
  assert.deepEqual(quarterPeriod(1, 2028), { start: "2028-01-01", end: "2028-03-31" });
  assert.deepEqual(quarterPeriod(3, 2026), { start: "2026-07-01", end: "2026-09-30" });
  assert.deepEqual(quarterPeriod(4, 2026), { start: "2026-10-01", end: "2026-12-31" });
  assert.deepEqual(yearPeriod(2026), { start: "2026-01-01", end: "2026-12-31" });
});

test("cycle labels parse in the usual spellings", () => {
  assert.deepEqual(parseQuarterLabel("Q3 2026"), { quarter: 3, year: 2026 });
  assert.deepEqual(parseQuarterLabel("q1/2027"), { quarter: 1, year: 2027 });
  assert.deepEqual(parseQuarterLabel("2026 Q2"), { quarter: 2, year: 2026 });
  assert.equal(parseQuarterLabel("Q5 2026"), null);
  assert.equal(parseQuarterLabel("Q3"), null);
  assert.equal(parseYearLabel("FY2026"), 2026);
  assert.equal(parseYearLabel("Năm 2027"), 2027);
});

test("an objective's period: own dates first, then its cycle label", () => {
  assert.deepEqual(objectivePeriod({ cycleType: "custom", cycleLabel: null, startDate: "2026-02-10T00:00:00.000Z", endDate: "2026-05-01" }), { start: "2026-02-10", end: "2026-05-01" });
  assert.deepEqual(objectivePeriod({ cycleType: "quarter", cycleLabel: "Q3 2026", startDate: null, endDate: null }), { start: "2026-07-01", end: "2026-09-30" });
  assert.deepEqual(objectivePeriod({ cycleType: "year", cycleLabel: "2026", startDate: null, endDate: "2026-06-30" }), { start: "2026-01-01", end: "2026-06-30" });
  assert.deepEqual(objectivePeriod({ cycleType: "custom", cycleLabel: null, startDate: "2026-03-01", endDate: null }), { start: "2026-03-01", end: "2026-03-01" });
  assert.equal(objectivePeriod({ cycleType: "quarter", cycleLabel: "", startDate: null, endDate: null }), null);
});

test("custom range keeps overlapping periods (inclusive), open ends are unbounded", () => {
  const q3 = { start: "2026-07-01", end: "2026-09-30" };
  assert.equal(overlaps(q3, "2026-09-30", "2026-10-15"), true, "touching the last day counts");
  assert.equal(overlaps(q3, "2026-10-01", "2026-12-31"), false);
  assert.equal(overlaps(q3, null, "2026-07-01"), true);
  assert.equal(overlaps(q3, "2026-10-01", null), false);
  assert.equal(overlaps(null, "2026-01-01", "2026-12-31"), false, "undated objectives drop out of a range");
  assert.equal(overlaps(null, null, null), true, "no range: everything");
});

test("range params ignore junk and swap a reversed range", () => {
  assert.deepEqual(rangeParams(new URL("http://x/?from=2026-12-31&to=2026-01-01")), { from: "2026-01-01", to: "2026-12-31" });
  assert.deepEqual(rangeParams(new URL("http://x/?from=2026-02-31&to=abc")), { from: null, to: null });
  assert.equal(isDateOnly("2026-02-28"), true);
  assert.equal(isDateOnly("2026-2-8"), false);
});

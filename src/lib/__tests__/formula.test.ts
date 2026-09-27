import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateFormula } from "../formula";

test("arithmetic respects precedence and parentheses", () => {
  assert.equal(evaluateFormula("1 + 2 * 3", {}), 7);
  assert.equal(evaluateFormula("(1 + 2) * 3", {}), 9);
});

test("field references resolve by name", () => {
  assert.equal(evaluateFormula("{Hours} * {Rate}", { Hours: 4, Rate: 25 }), 100);
});

test("IF with comparison", () => {
  assert.equal(evaluateFormula('IF({Progress} >= 100, "Completed", "In Progress")', { Progress: 100 }), "Completed");
  assert.equal(evaluateFormula('IF({Progress} >= 100, "Completed", "In Progress")', { Progress: 40 }), "In Progress");
});

test("logical and text functions", () => {
  assert.equal(evaluateFormula("AND(1 > 0, 2 > 1)", {}), true);
  assert.equal(evaluateFormula("OR(1 > 2, NOT(1 > 2))", {}), true);
  assert.equal(evaluateFormula('CONCAT("HR-", UPPER("ops"))', {}), "HR-OPS");
  assert.equal(evaluateFormula('LEN("abcd")', {}), 4);
});

test("aggregate functions", () => {
  assert.equal(evaluateFormula("SUM(1, 2, 3)", {}), 6);
  assert.equal(evaluateFormula("AVG(2, 4)", {}), 3);
  assert.equal(evaluateFormula("MAX(2, 9, 4)", {}), 9);
  assert.equal(evaluateFormula("MIN(2, 9, 4)", {}), 2);
});

test("DATE_DIFF counts days between two dates", () => {
  const diff = evaluateFormula('DATE_DIFF("2026-01-10", "2026-01-01")', {});
  assert.equal(Math.abs(Number(diff)), 9);
});

test("a malformed expression returns #ERROR instead of throwing", () => {
  assert.equal(evaluateFormula("1 + (", {}), "#ERROR");
});

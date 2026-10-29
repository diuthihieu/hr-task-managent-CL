import { test } from "node:test";
import assert from "node:assert/strict";
import { migrationOrderProblems } from "../../../scripts/check-migration-order.mjs";

const base = ["20260926140100_constraints_and_triggers", "20270104000000_ai_usage_events", "20270105000000_push_subscriptions"];

test("migration order (BUG-03): a new migration must sort after every migration on the base branch", () => {
  assert.deepEqual(migrationOrderProblems(base, base), [], "nothing new");
  assert.deepEqual(migrationOrderProblems(base, [...base, "20270106000000_next"]), [], "named after the newest");
  // What `prisma migrate dev` names it today (real UTC time) lands in the middle.
  assert.equal(migrationOrderProblems(base, [...base, "20261028022107_thu_nghiem"]).length, 1);
  assert.equal(migrationOrderProblems(base, [...base, "20270105000000_push_subscriptions_v2"]).length, 0, "same prefix but sorts after");
  assert.equal(migrationOrderProblems(base, [...base, "20270104000000_zzz"]).length, 1, "sorts before the newest");
  assert.equal(migrationOrderProblems(base, [...base, "add_column"]).length, 1, "needs a 14-digit prefix");
  assert.equal(migrationOrderProblems(base, [...base, "2027010700000_short"]).length, 1, "13 digits");
  assert.deepEqual(migrationOrderProblems([], ["20270101000000_first"]), [], "empty base");
});

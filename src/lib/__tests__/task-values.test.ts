// Incoming cell values are coerced to typed columns before anything is written; bad input is a 400.
import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../http-errors";
import { assertUuids, fromDateOnly, isUuid, okrTargetToken, toDateOnly, toIdArray, toIdOrNull, toNumber, toTimestamp } from "../../server/tasks/values";
import { addRecurrence, parseRecurrence } from "../../server/tasks/recurrence";

const rejects = (fn: () => unknown, msg: RegExp) =>
  assert.throws(fn, (e: unknown) => e instanceof HttpError && e.status === 400 && msg.test(e.message));

test("date-only values: YYYY-MM-DD or an ISO string, stored as UTC midnight; real calendar dates only", () => {
  assert.equal(toDateOnly("2026-10-28", "Due")!.toISOString(), "2026-10-28T00:00:00.000Z");
  assert.equal(toDateOnly("2026-10-28T23:59:00+07:00", "Due")!.toISOString(), "2026-10-28T00:00:00.000Z", "the date part as written");
  for (const empty of [null, undefined, ""]) assert.equal(toDateOnly(empty, "Due"), null);
  rejects(() => toDateOnly("28/10/2026", "Due"), /Due must be a date/);
  rejects(() => toDateOnly(20261028, "Due"), /must be a date/);
  rejects(() => toDateOnly("2026-02-30", "Due"), /not a valid date/);
  assert.equal(fromDateOnly(new Date("2026-10-28T00:00:00Z")), "2026-10-28");
  assert.equal(fromDateOnly(null), null);
});

test("timestamps, numbers and ids", () => {
  assert.equal(toTimestamp("2026-10-28T08:00:00Z", "Done at")!.toISOString(), "2026-10-28T08:00:00.000Z");
  rejects(() => toTimestamp("yesterday", "Done at"), /not a valid date\/time/);
  rejects(() => toTimestamp(5, "Done at"), /must be a date\/time/);
  assert.equal(toNumber("7.5", "Estimate"), 7.5);
  assert.equal(toNumber("", "Estimate"), null);
  rejects(() => toNumber("seven", "Estimate"), /must be a number/);
  rejects(() => toNumber(Infinity, "Estimate"), /must be a number/);
  assert.equal(toIdOrNull("", "Status"), null);
  rejects(() => toIdOrNull(3, "Status"), /must be an id/);
  assert.deepEqual(toIdArray(["a", "b", "a"], "Assignees"), ["a", "b"], "duplicates removed");
  rejects(() => toIdArray("a", "Assignees"), /list of ids/);
  rejects(() => toIdArray(["a", 1], "Assignees"), /list of ids/);
  const id = "0b8496be-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
  assert.ok(isUuid(id) && !isUuid("not-a-uuid") && !isUuid(null));
  assert.doesNotThrow(() => assertUuids([id], "Assignees"));
  rejects(() => assertUuids([id, "x"], "Assignees"), /Assignees: invalid id/);
});

test("the Objective field: a key result wins over its objective", () => {
  assert.equal(okrTargetToken({ keyResultId: "k1", objectiveId: "o1" }), "kr:k1");
  assert.equal(okrTargetToken({ keyResultId: null, objectiveId: "o1" }), "obj:o1");
  assert.equal(okrTargetToken({ keyResultId: null, objectiveId: null }), null);
});

test("recurrence: daily / weekly / monthly, interval 1-365, month ends clamp", () => {
  assert.equal(parseRecurrence(null), null);
  assert.deepEqual(parseRecurrence({ freq: "weekly" }), { freq: "weekly", interval: 1 });
  assert.deepEqual(parseRecurrence({ freq: "monthly", interval: "2" }), { freq: "monthly", interval: 2 });
  rejects(() => parseRecurrence({ freq: "hourly" }), /daily, weekly or monthly/);
  rejects(() => parseRecurrence({ freq: "daily", interval: 0 }), /1-365/);
  rejects(() => parseRecurrence({ freq: "daily", interval: 1.5 }), /1-365/);
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  assert.equal(iso(addRecurrence(d("2026-10-28"), { freq: "daily", interval: 5 })), "2026-11-02");
  assert.equal(iso(addRecurrence(d("2026-12-29"), { freq: "weekly", interval: 1 })), "2027-01-05");
  assert.equal(iso(addRecurrence(d("2026-01-31"), { freq: "monthly", interval: 1 })), "2026-02-28", "31 Jan + 1 month = end of February");
  assert.equal(iso(addRecurrence(d("2028-01-31"), { freq: "monthly", interval: 1 })), "2028-02-29", "leap year");
  assert.equal(iso(addRecurrence(d("2026-11-15"), { freq: "monthly", interval: 3 })), "2027-02-15");
});

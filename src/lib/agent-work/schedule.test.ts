import { test } from "node:test";
import assert from "node:assert/strict";
import { nextRunAt, workflowSchedule } from "./schedule";

const vn = (iso: string) => new Date(`${iso}+07:00`);
const s = (o: object) => workflowSchedule.parse(o);

test("hourly at :15, Vietnam time", () => {
  assert.equal(nextRunAt(s({ freq: "hourly", minute: 15 }), vn("2026-11-12T08:10:00")).toISOString(), vn("2026-11-12T08:15:00").toISOString());
  assert.equal(nextRunAt(s({ freq: "hourly", minute: 15 }), vn("2026-11-12T08:15:00")).toISOString(), vn("2026-11-12T09:15:00").toISOString(), "strictly after");
});

test("daily at 08:00 rolls to tomorrow once passed, across a month end", () => {
  assert.equal(nextRunAt(s({ freq: "daily", hour: 8 }), vn("2026-11-30T09:00:00")).toISOString(), vn("2026-12-01T08:00:00").toISOString());
  assert.equal(nextRunAt(s({ freq: "daily", hour: 8 }), vn("2026-11-30T07:59:00")).toISOString(), vn("2026-11-30T08:00:00").toISOString());
});

test("weekly on Monday and Thursday", () => {
  // 2026-11-12 is a Thursday.
  const sch = s({ freq: "weekly", hour: 8, minute: 30, weekdays: [0, 3] });
  assert.equal(nextRunAt(sch, vn("2026-11-12T07:00:00")).toISOString(), vn("2026-11-12T08:30:00").toISOString());
  assert.equal(nextRunAt(sch, vn("2026-11-12T09:00:00")).toISOString(), vn("2026-11-16T08:30:00").toISOString());
});

test("monthly on the 31st means the last day of shorter months", () => {
  const sch = s({ freq: "monthly", monthDay: 31, hour: 17 });
  assert.equal(nextRunAt(sch, vn("2026-11-12T00:00:00")).toISOString(), vn("2026-11-30T17:00:00").toISOString());
  assert.equal(nextRunAt(sch, vn("2026-11-30T18:00:00")).toISOString(), vn("2026-12-31T17:00:00").toISOString());
  assert.equal(nextRunAt(sch, vn("2027-01-31T18:00:00")).toISOString(), vn("2027-02-28T17:00:00").toISOString());
});

test("a day boundary in UTC is not a day boundary in Vietnam", () => {
  // 23:30 UTC on the 11th is 06:30 on the 12th in Vietnam.
  assert.equal(nextRunAt(s({ freq: "daily", hour: 7 }), new Date("2026-11-11T23:30:00Z")).toISOString(), vn("2026-11-12T07:00:00").toISOString());
});

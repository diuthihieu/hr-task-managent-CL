// Run in Vietnam time so a UTC-vs-local mix-up shows (UTC+7, no DST).
process.env.TZ = "Asia/Ho_Chi_Minh";

import { test } from "node:test";
import assert from "node:assert/strict";
import { isoToLocalInput, localInputToIso } from "./datetime-local";

test("a stored UTC time is shown in the viewer's local time", () => {
  assert.equal(isoToLocalInput("2026-10-24T02:30:00.000Z"), "2026-10-24T09:30");
  // 23:00 UTC is already the next day in Vietnam.
  assert.equal(isoToLocalInput("2026-10-31T23:00:00.000Z"), "2026-11-01T06:00");
  assert.equal(isoToLocalInput("2026-10-24T09:30:00+07:00"), "2026-10-24T09:30");
});

test("what the user types round-trips to the same local time", () => {
  for (const typed of ["2026-10-24T09:30", "2026-11-01T06:00", "2026-12-31T23:59"]) {
    assert.equal(isoToLocalInput(localInputToIso(typed)), typed);
  }
  assert.equal(localInputToIso("2026-10-24T09:30"), "2026-10-24T02:30:00.000Z");
});

test("empty, invalid and zone-less values", () => {
  assert.equal(isoToLocalInput(null), "");
  assert.equal(isoToLocalInput(""), "");
  assert.equal(isoToLocalInput("not a date"), "");
  // A value without a zone is already wall-clock time: keep it.
  assert.equal(isoToLocalInput("2026-10-24T09:30"), "2026-10-24T09:30");
  assert.equal(localInputToIso(""), null);
  assert.equal(localInputToIso(null), null);
  assert.equal(localInputToIso("garbage"), null);
});

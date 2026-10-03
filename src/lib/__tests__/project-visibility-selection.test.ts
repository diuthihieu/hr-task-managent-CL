import assert from "node:assert/strict";
import test from "node:test";
import { setAllHideableMembers } from "../project-visibility-selection";

const members = [
  { id: "member-a", lockedReason: null },
  { id: "member-b", lockedReason: null },
  { id: "workspace-admin", lockedReason: "admin" },
];

test("bulk project visibility hides only eligible members", () => {
  assert.deepEqual([...setAllHideableMembers(new Set(["workspace-admin"]), members, true)].sort(), ["member-a", "member-b"]);
});

test("bulk project visibility can restore access for all eligible members", () => {
  assert.deepEqual([...setAllHideableMembers(new Set(["member-a", "member-b"]), members, false)], []);
});

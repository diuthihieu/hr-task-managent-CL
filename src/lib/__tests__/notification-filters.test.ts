// The inbox filters decide which notifications the bell and the Action center list:
// muted groups, chips, and the "you can redeem a reward" notices that live under Recognition.
import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { REWARD_REACHABLE, deviceOnlyGroups, inGroups, ofTypes, parseTypes } from "../../server/notifications/filters";

test("a muted group's filter covers its types; AI and recognition split the ai_suggestion notices", () => {
  assert.deepEqual(inGroups(["mention", "comment"]), { OR: [{ type: { in: ["mention", "task_comment"] } }] });
  const ai = inGroups(["ai"]).OR!;
  assert.deepEqual(ai[0], { type: { in: [] } }, "ai_suggestion is never matched by type alone");
  assert.deepEqual(ai[1], { type: "ai_suggestion", OR: [{ data: { equals: Prisma.AnyNull } }, { NOT: REWARD_REACHABLE }] }, "AI = suggestions other than reward-reachable");
  const recognition = inGroups(["recognition"]).OR!;
  assert.deepEqual(recognition[0], { type: { in: ["kudos", "kudos_reaction", "reward_request", "reward_result"] } });
  assert.deepEqual(recognition[1], REWARD_REACHABLE, "reward-reachable notices count as recognition");
  assert.equal(inGroups(["ai", "recognition"]).OR!.length, 3);
});

test("Action center chips: ai_suggestion means plain AI notices, kudos also brings reward-reachable ones", () => {
  assert.deepEqual(ofTypes(["mention"]), { OR: [{ type: { in: ["mention"] } }] });
  assert.deepEqual(ofTypes(["ai_suggestion"]).OR!.slice(1), [{ type: "ai_suggestion", OR: [{ data: { equals: Prisma.AnyNull } }, { NOT: REWARD_REACHABLE }] }]);
  assert.deepEqual(ofTypes(["kudos"]), { OR: [{ type: { in: ["kudos"] } }, REWARD_REACHABLE] });
});

test("?types= keeps plausible type names only, at most 20", () => {
  assert.deepEqual(parseTypes(null), []);
  assert.deepEqual(parseTypes(" mention , task_comment ,,"), ["mention", "task_comment"]);
  assert.deepEqual(parseTypes("mention,DROP TABLE,a'b,x".concat(",y".repeat(30))).length, 20);
  assert.deepEqual(parseTypes("mention,Upper,with space,semi;colon"), ["mention"]);
  assert.deepEqual(parseTypes("a".repeat(41)), [], "over 40 characters");
});

test("device-only groups: off in the app, still on for the device", () => {
  assert.deepEqual(deviceOnlyGroups(["updates", "ai"], ["ai"]), ["updates"]);
  assert.deepEqual(deviceOnlyGroups([], ["ai"]), []);
  assert.deepEqual(deviceOnlyGroups(["updates"], []), ["updates"]);
});

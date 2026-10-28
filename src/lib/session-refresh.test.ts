import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionRefreshProof, verifySessionRefresh } from "./session-refresh";

process.env.AUTH_SECRET ??= "unit-test-secret-unit-test-secret-unit-test";
const U = "11111111-1111-4111-8111-111111111111";

test("a refresh proof only works for its own user and session version, within a minute", () => {
  const now = 1_000_000;
  const proof = sessionRefreshProof(U, 3, now);
  assert.equal(verifySessionRefresh(proof, U, 3, now + 30_000), true);
  assert.equal(verifySessionRefresh(proof, U, 4, now), false, "other version");
  assert.equal(verifySessionRefresh(proof, "22222222-2222-4222-8222-222222222222", 3, now), false, "other user");
  assert.equal(verifySessionRefresh(proof, U, 3, now + 61_000), false, "expired");
  const [u, sv, exp, sig] = proof.split(".");
  assert.equal(verifySessionRefresh(`${u}.${sv}.${Number(exp) + 3600_000}.${sig}`, U, 3, now), false, "extended expiry");
  assert.equal(verifySessionRefresh(`${u}.${sv}.${exp}.${sig.slice(0, -2)}`, U, 3, now), false, "tampered signature");
  for (const bad of [undefined, null, 3, "", "forged.proof", {}]) assert.equal(verifySessionRefresh(bad, U, 3, now), false);
});

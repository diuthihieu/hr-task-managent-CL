import assert from "node:assert/strict";
import test from "node:test";
import { readMicrosoftIdentity, singleTenantIssuer } from "../microsoft-identity";

const tid = "72f988bf-86f1-41af-91ab-2d7cd011db47";
const oid = "00000000-0000-0000-66f3-3332eca7ea81";

test("single-tenant only when the issuer names a tenant id", () => {
  assert.equal(singleTenantIssuer(`https://login.microsoftonline.com/${tid}/v2.0`), true);
  assert.equal(singleTenantIssuer("https://login.microsoftonline.com/common/v2.0"), false);
  assert.equal(singleTenantIssuer("https://login.microsoftonline.com/organizations/v2.0"), false);
  assert.equal(singleTenantIssuer(undefined), false);
});

test("identity is tenant + object id; missing ids are rejected", () => {
  assert.equal(readMicrosoftIdentity({ tid, oid, email: "A@B.com" }, true)?.key, `${tid}:${oid}`);
  assert.equal(readMicrosoftIdentity({ oid, email: "a@b.com" }, true), null);
  assert.equal(readMicrosoftIdentity({ tid, oid: "not-a-guid" }, true), null);
});

test("multi-tenant emails are untrusted unless the domain owner verified them (nOAuth)", () => {
  assert.equal(readMicrosoftIdentity({ tid, oid, email: "ceo@victim.com" }, false)?.emailTrusted, false);
  assert.equal(readMicrosoftIdentity({ tid, oid, email: "ceo@victim.com", xms_edov: true }, false)?.emailTrusted, true);
  assert.equal(readMicrosoftIdentity({ tid, oid, email: "lan@corp.com" }, true)?.emailTrusted, true);
});

test("the UPN is a fallback email only inside a single tenant", () => {
  assert.equal(readMicrosoftIdentity({ tid, oid, preferred_username: "Lan@Corp.com" }, true)?.email, "lan@corp.com");
  assert.equal(readMicrosoftIdentity({ tid, oid, preferred_username: "lan@corp.com" }, false)?.email, "");
});

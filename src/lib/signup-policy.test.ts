import { test } from "node:test";
import assert from "node:assert/strict";
import { signupDomainAllowed } from "./signup-policy";

test("signup domains: empty list is open; otherwise the exact domain after the last @, any case", () => {
  assert.equal(signupDomainAllowed("anyone@gmail.com", {}), true, "unset = open sign-up");
  assert.equal(signupDomainAllowed("anyone@gmail.com", { SIGNUP_ALLOWED_DOMAINS: " , " }), true, "blank entries = open");
  const env = { SIGNUP_ALLOWED_DOMAINS: "Bestarion.com, partner.vn" };
  assert.equal(signupDomainAllowed("hr@bestarion.com", env), true);
  assert.equal(signupDomainAllowed("HR@BESTARION.COM", env), true);
  assert.equal(signupDomainAllowed("a@partner.vn", env), true);
  assert.equal(signupDomainAllowed("hr@a.bestarion.com", env), false, "subdomains don't match");
  assert.equal(signupDomainAllowed("hr@bestarion.com.evil.io", env), false);
  assert.equal(signupDomainAllowed("x@bestarion.com@gmail.com", env), false, "the last @ decides");
  assert.equal(signupDomainAllowed("no-at-sign", env), false);
});

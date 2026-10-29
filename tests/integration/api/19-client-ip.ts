import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE, prisma } from "./context";

// BUG-13: the integration server runs with TRUSTED_PROXY=nginx, so only X-Real-IP
// counts; an X-Forwarded-For the client made up never becomes a rate-limit key.
test("rate limits key on the trusted proxy's header only", async () => {
  const r = await fetch(`${BASE}/api/account/password-reset/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.9" },
    body: JSON.stringify({ token: "x", password: "Abcdefgh1" }),
  });
  assert.ok(r.status >= 400);
  assert.equal(await prisma.rateLimit.findUnique({ where: { key: "pw-reset-confirm:198.51.100.9" } }), null, "a client-chosen X-Forwarded-For is not a key");
  await fetch(`${BASE}/api/account/password-reset/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": "198.51.100.10" },
    body: JSON.stringify({ token: "x", password: "Abcdefgh1" }),
  });
  assert.ok(await prisma.rateLimit.findUnique({ where: { key: "pw-reset-confirm:198.51.100.10" } }), "the proxy's X-Real-IP is");
});

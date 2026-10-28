import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE, admin } from "./context";

// BUG-15: a signed-in write from another site is refused even if the browser sent the cookie.
const write = (headers: Record<string, string>) =>
  fetch(`${BASE}/api/account/profile`, { method: "PATCH", headers: { cookie: admin.cookieHeader(), "content-type": "application/json", ...headers }, body: JSON.stringify({ jobTitle: "HR Director" }) });

test("cross-site writes are refused; same-site, proxied and non-browser writes still work", async () => {
  for (const [label, headers] of [
    ["foreign Origin", { origin: "https://evil.example" }],
    ["Origin: null", { origin: "null" }],
    ["no Origin, Sec-Fetch-Site: cross-site", { "sec-fetch-site": "cross-site" }],
    ["proxied host the request didn't come through", { origin: "https://hr.example.com" }],
  ] as const) {
    const r = await write(headers);
    assert.equal(r.status, 403, `${label}: ${r.status}`);
  }
  for (const [label, headers] of [
    ["no Origin (cron, curl, CI)", {}],
    ["same origin", { origin: BASE }],
    ["same origin, other forwarded host", { origin: BASE, "x-forwarded-host": "other.example" }],
    ["behind a proxy that forwards the host", { origin: "https://hr.example.com", "x-forwarded-host": "hr.example.com" }],
    ["same-origin fetch metadata", { origin: BASE, "sec-fetch-site": "same-origin" }],
  ] as const) {
    const r = await write(headers);
    assert.equal(r.status, 200, `${label}: ${r.status}`);
  }
  // Reads are never affected.
  assert.equal((await fetch(`${BASE}/api/account/profile`, { headers: { cookie: admin.cookieHeader(), origin: "https://evil.example" } })).status, 200);
});

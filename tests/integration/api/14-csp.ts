import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE, viewer } from "./context";

// BUG-10: a per-request nonce CSP (Report-Only for now) on every HTML page.
const POLICY = /^script-src 'self' 'nonce-([A-Za-z0-9+/=]+)' 'strict-dynamic'(?: 'unsafe-eval')?; object-src 'none'; base-uri 'self'; report-uri \/api\/csp-report$/;

async function page(path: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${BASE}${path}`, { redirect: "manual", headers });
  return { res, html: await res.text(), policy: res.headers.get("content-security-policy-report-only") ?? "" };
}

test("CSP: every HTML page carries a fresh script nonce, and the inline scripts use it", async () => {
  const seen = new Set<string>();
  for (const [path, headers] of [
    ["/", {}],
    ["/privacy", {}],
    ["/workspaces", { cookie: viewer.cookieHeader() }],
  ] as const) {
    const { res, html, policy } = await page(path, headers);
    assert.equal(res.status, 200, path);
    const nonce = POLICY.exec(policy)?.[1];
    assert.ok(nonce, `${path}: Report-Only policy with a nonce (got "${policy}")`);
    seen.add(nonce);
    const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    assert.ok(scripts.length > 0, `${path}: has scripts`);
    assert.deepEqual(scripts.filter((s) => !s.includes(`nonce="${nonce}"`)), [], `${path}: every script tag carries the nonce`);
  }
  assert.equal(seen.size, 3, "a new nonce per request");
  // The existing enforced header (frame-ancestors etc.) is unchanged.
  assert.match((await page("/")).res.headers.get("content-security-policy") ?? "", /frame-ancestors 'self'/);
});

test("CSP: a nonce or policy sent by the client is never used", async () => {
  const { html, policy } = await page("/privacy", { "content-security-policy-report-only": "script-src 'nonce-attacker'", "content-security-policy": "script-src 'nonce-attacker'", "x-nonce": "attacker" });
  assert.doesNotMatch(html, /nonce="attacker"/);
  assert.doesNotMatch(policy, /attacker/);
  // Signed-out workspace links still go to sign-in.
  const w = await page("/w/some-team/p/1");
  assert.ok([303, 307, 308].includes(w.res.status));
  assert.match(w.res.headers.get("location") ?? "", /auth=login/);
});

test("CSP: the report endpoint takes both report formats, caps the size, answers 204", async () => {
  const post = (body: string, type: string) => fetch(`${BASE}/api/csp-report`, { method: "POST", headers: { "content-type": type }, body });
  const legacy = await post(JSON.stringify({ "csp-report": { "document-uri": `${BASE}/`, "violated-directive": "script-src", "blocked-uri": "inline" } }), "application/csp-report");
  assert.equal(legacy.status, 204);
  const modern = await post(JSON.stringify([{ type: "csp-violation", body: { documentURL: `${BASE}/`, effectiveDirective: "script-src-elem", blockedURL: "https://evil.example/x.js" } }]), "application/reports+json");
  assert.equal(modern.status, 204);
  assert.equal((await post("x".repeat(9000), "application/csp-report")).status, 413, "over 8 KB");
  assert.equal((await post("not json", "application/csp-report")).status, 400);
  assert.equal((await fetch(`${BASE}/api/csp-report`)).status, 405, "POST only");
});

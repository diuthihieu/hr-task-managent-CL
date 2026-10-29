import { test } from "node:test";
import assert from "node:assert/strict";
import { readClientIp, resolveProxyMode } from "../client-ip";

const h = (o: Record<string, string>) => new Headers(o);

test("proxy mode: TRUSTED_PROXY wins; otherwise vercel on Vercel, none elsewhere", () => {
  assert.equal(resolveProxyMode({}), "none");
  assert.equal(resolveProxyMode({ VERCEL: "1" }), "vercel");
  assert.equal(resolveProxyMode({ TRUSTED_PROXY: "nginx" }), "nginx");
  assert.equal(resolveProxyMode({ TRUSTED_PROXY: " NGINX " }), "nginx");
  assert.equal(resolveProxyMode({ TRUSTED_PROXY: "none", VERCEL: "1" }), "none");
  assert.equal(resolveProxyMode({ TRUSTED_PROXY: "cloudflare" }), "none", "unknown value: trust nothing");
});

test("client IP: each mode reads only the header its proxy sets; spoofed headers are ignored", () => {
  const spoof = { "x-real-ip": "6.6.6.6", "x-forwarded-for": "7.7.7.7, 10.0.0.1" };
  // none: nothing is trusted, whatever the client sends.
  assert.equal(readClientIp(h(spoof), "none"), null);
  assert.equal(readClientIp(h({ "x-vercel-forwarded-for": "8.8.8.8" }), "none"), null);
  // nginx: only X-Real-IP (set by proxy_set_header X-Real-IP $remote_addr), never X-Forwarded-For.
  assert.equal(readClientIp(h(spoof), "nginx"), "6.6.6.6");
  assert.equal(readClientIp(h({ "x-forwarded-for": "7.7.7.7", "x-vercel-forwarded-for": "8.8.8.8" }), "nginx"), null);
  // vercel: the platform's headers (Vercel overwrites them), never X-Forwarded-For.
  assert.equal(readClientIp(h({ "x-vercel-forwarded-for": "1.2.3.4, 5.6.7.8", ...spoof }), "vercel"), "1.2.3.4");
  assert.equal(readClientIp(h({ "x-forwarded-for": "7.7.7.7" }), "vercel"), null);
  // Junk and oversize values aren't keys.
  assert.equal(readClientIp(h({ "x-real-ip": "  " }), "nginx"), null);
  assert.equal(readClientIp(h({ "x-real-ip": "x".repeat(200) }), "nginx")?.length, 64);
});

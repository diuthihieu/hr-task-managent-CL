import { test } from "node:test";
import assert from "node:assert/strict";
import { isCrossSiteWrite } from "./origin-check";

const req = (method: string, headers: Record<string, string>, url = "http://0.0.0.0:3000/api/x") => new Request(url, { method, headers });
const env = { AUTH_URL: "https://hr.company.com", ALLOWED_ORIGINS: "https://partner.example, https://other.example" };

test("writes from another site are flagged; same host, configured and non-browser callers are not", () => {
  const cross = [
    req("POST", { origin: "https://evil.example", host: "hr.company.com" }),
    req("DELETE", { origin: "null", host: "hr.company.com" }),
    req("PATCH", { origin: "not a url", host: "hr.company.com" }),
    req("PUT", { "sec-fetch-site": "cross-site", host: "hr.company.com" }),
    req("POST", { origin: "https://hr.example.com", host: "app:3000" }),
  ];
  for (const r of cross) assert.equal(isCrossSiteWrite(r, env), true, `${r.method} ${r.headers.get("origin")}`);
  const ok = [
    req("POST", { host: "hr.company.com" }),
    req("POST", { origin: "https://hr.company.com", host: "app:3000" }, "http://app:3000/api/x"),
    req("POST", { origin: "http://localhost:3100", host: "localhost:3100" }),
    req("POST", { origin: "https://hr.example.com", host: "app:3000", "x-forwarded-host": "hr.example.com, proxy.internal" }),
    req("POST", { origin: "https://partner.example", host: "app:3000" }),
    req("POST", { "sec-fetch-site": "same-origin", host: "x" }),
    req("GET", { origin: "https://evil.example", host: "hr.company.com" }),
  ];
  for (const r of ok) assert.equal(isCrossSiteWrite(r, env), false, `${r.method} ${r.headers.get("origin")}`);
});

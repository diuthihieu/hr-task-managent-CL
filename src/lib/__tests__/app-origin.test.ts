import assert from "node:assert/strict";
import test from "node:test";
import { appOrigin } from "../app-origin";

const req = new Request("https://attacker.example/api/account/password-reset/request");

test("secret-bearing links use the configured origin, never the request host", () => {
  assert.equal(appOrigin(req, { AUTH_URL: "https://woli.app/some/path" }), "https://woli.app");
  assert.equal(appOrigin(req, { VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "woli.vercel.app", VERCEL_URL: "woli-abc.vercel.app" }), "https://woli.vercel.app");
  assert.equal(appOrigin(req, { VERCEL_ENV: "preview", VERCEL_URL: "woli-abc.vercel.app" }), "https://woli-abc.vercel.app");
  assert.equal(appOrigin(req, { AUTH_URL: "not a url", VERCEL_URL: "woli-abc.vercel.app" }), "https://woli-abc.vercel.app");
  assert.equal(appOrigin(new Request("http://localhost:3000/x"), {}), "http://localhost:3000", "local dev only");
});

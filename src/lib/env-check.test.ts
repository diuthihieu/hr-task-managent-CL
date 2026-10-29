import { test } from "node:test";
import assert from "node:assert/strict";
import { configProblems, configWarnings } from "./env-check";

const DB = "postgresql://x";
test("unsafe AUTH_SECRET values are refused", () => {
  assert.match(configProblems({ DATABASE_URL: DB }).join(), /not set/);
  assert.match(configProblems({ DATABASE_URL: DB, AUTH_SECRET: "short" }).join(), /32 characters/);
  assert.match(configProblems({ DATABASE_URL: DB, AUTH_SECRET: "change-me-to-a-random-32-byte-base64-string" }).join(), /placeholder/);
  assert.match(configProblems({ DATABASE_URL: DB, AUTH_SECRET: "replace-me-with-a-random-32-byte-base64-string" }).join(), /placeholder/);
  assert.deepEqual(configProblems({ DATABASE_URL: DB, AUTH_SECRET: "FPotTBo2ImWcmW71oS5m23Mqj1XUWO3ajNccVFPXOLQ=" }), []);
  assert.match(configProblems({ AUTH_SECRET: "FPotTBo2ImWcmW71oS5m23Mqj1XUWO3ajNccVFPXOLQ=" }).join(), /DATABASE_URL/);
});

test("config warnings: outside Vercel without TRUSTED_PROXY, warn (never refuse to start)", () => {
  assert.equal(configWarnings({}).length, 1);
  assert.match(configWarnings({})[0], /TRUSTED_PROXY/);
  assert.deepEqual(configWarnings({ TRUSTED_PROXY: "nginx" }), []);
  assert.deepEqual(configWarnings({ TRUSTED_PROXY: "none" }), [], "an explicit choice is respected");
  assert.deepEqual(configWarnings({ VERCEL: "1" }), []);
  assert.deepEqual(configProblems({ AUTH_SECRET: "x".repeat(40), DATABASE_URL: "postgres://x" }), [], "not a start-up problem");
});

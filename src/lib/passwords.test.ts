import { test } from "node:test";
import assert from "node:assert/strict";
import { assertPasswordPolicy, generateTemporaryPassword, randomAvatarColor } from "./passwords";

test("passwords longer than bcrypt's 72 bytes are refused instead of silently cut", () => {
  assert.equal(assertPasswordPolicy("Ab1" + "x".repeat(69)).length, 72);
  assert.throws(() => assertPasswordPolicy("Ab1" + "x".repeat(70)), /too long/);
  assert.ok(assertPasswordPolicy("Ab1" + "ệ".repeat(23)), "72 bytes of Vietnamese is fine");
  assert.throws(() => assertPasswordPolicy("Ab1" + "ệ".repeat(24)), /too long/);
  assert.throws(() => assertPasswordPolicy("Ab1" + "x".repeat(200)), /too long/);
  assert.throws(() => assertPasswordPolicy("short1"), /at least/);
});

test("temporary passwords and avatar colours keep their alphabet", () => {
  for (let i = 0; i < 1000; i++) assert.match(generateTemporaryPassword(), /^[a-hjkmnp-zA-HJKMNP-Z]{9}[2-9]{3}$/);
  const colours = new Set(Array.from({ length: 200 }, randomAvatarColor));
  for (const c of colours) assert.match(c, /^#[0-9a-f]{6}$/);
});

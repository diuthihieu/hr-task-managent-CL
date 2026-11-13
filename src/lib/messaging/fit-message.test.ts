import { test } from "node:test";
import assert from "node:assert/strict";
import { fitMessage } from "./fit-message";

test("short text is kept; long text ends at a block when one is near", () => {
  assert.equal(fitMessage("abc", 10), "abc");
  const text = `${"a".repeat(60)}\n\n${"b".repeat(60)}`;
  assert.equal(fitMessage(text, 100), `${"a".repeat(60)}\n…`);
});

test("a table longer than the limit is cut between rows, never inside one", () => {
  const rows = Array.from({ length: 40 }, (_, i) => `| task ${i} | ${i} |`);
  const text = ["| Task | Hours |", "|---|---|", ...rows].join("\n");
  const out = fitMessage(text, 300);
  assert.ok(out.length <= 300);
  const kept = out.split("\n").slice(0, -1);
  assert.ok(kept.length > 3);
  for (const l of kept) assert.match(l, /^\|.*\|$/, `whole row: ${l}`);
});

test("one line longer than the limit is cut inside", () => {
  assert.equal(fitMessage("x".repeat(50), 20), `${"x".repeat(18)}\n…`);
});

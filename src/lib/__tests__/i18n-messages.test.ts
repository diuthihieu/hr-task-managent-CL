// The UI text is split into one file per area and merged with object spread, which would
// silently let a key in one file override the same key in another. This keeps every key in
// exactly one file and every entry complete in both languages.
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { MESSAGES } from "../i18n/messages";

test("each message key is defined in exactly one area file", async () => {
  const dir = join(__dirname, "..", "i18n", "messages");
  const seen = new Map<string, string>();
  const dupes: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
    const mod = (await import(join(dir, file))) as Record<string, Record<string, unknown>>;
    for (const group of Object.values(mod))
      for (const key of Object.keys(group)) {
        if (seen.has(key)) dupes.push(`${key} in ${seen.get(key)} and ${file}`);
        seen.set(key, file);
      }
  }
  assert.deepEqual(dupes, []);
  assert.equal(seen.size, Object.keys(MESSAGES).length, "every area file is merged into MESSAGES");
});

test("every message has an English and a Vietnamese text with the same placeholders", () => {
  const bad: string[] = [];
  const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  for (const [key, entry] of Object.entries(MESSAGES) as [string, readonly string[]][]) {
    if (entry.length !== 2 || !entry[0].trim() || !entry[1].trim()) bad.push(`${key}: missing text`);
    else if (vars(entry[0]) !== vars(entry[1])) bad.push(`${key}: {${vars(entry[0])}} vs {${vars(entry[1])}}`);
  }
  assert.deepEqual(bad, []);
});

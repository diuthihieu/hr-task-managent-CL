import assert from "node:assert/strict";
import test from "node:test";
import { splitMessage } from "./split-message";

test("splitMessage: a text that fits is one message", () => {
  assert.deepEqual(splitMessage("  abc\n\ndef  ", 100), ["abc\n\ndef"]);
});

test("splitMessage: parts end between blocks and nothing is lost", () => {
  const blocks = Array.from({ length: 30 }, (_, i) => `## Section ${i}\n${"word ".repeat(20).trim()}`);
  const parts = splitMessage(blocks.join("\n\n"), 400);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((p) => p.length <= 400));
  assert.equal(parts.join("\n\n"), blocks.join("\n\n"));
  assert.ok(parts.every((p) => p.startsWith("## Section")), "no part starts in the middle of a block");
});

test("splitMessage: a long table continues with its header in every part, every row once", () => {
  const head = "| Name | Hours |\n| :--- | ---: |";
  const rows = Array.from({ length: 60 }, (_, i) => `| Person ${i} | ${i}.5 |`);
  const parts = splitMessage(`Intro\n\n${head}\n${rows.join("\n")}\n\nEnd`, 300);
  assert.ok(parts.every((p) => p.length <= 300));
  const tables = parts.filter((p) => p.includes("| Person"));
  assert.ok(tables.length > 1);
  for (const t of tables) assert.ok(t.includes(head), "each part of the table has the header");
  const seen = parts.flatMap((p) => p.split("\n").filter((l) => l.startsWith("| Person")));
  assert.deepEqual(seen, rows);
  assert.ok(parts[0].startsWith("Intro"));
  assert.ok(parts.at(-1)!.endsWith("End"));
});

test("splitMessage: one line longer than the limit is divided, nothing dropped", () => {
  const parts = splitMessage("x".repeat(250), 100);
  assert.deepEqual(parts.map((p) => p.length), [100, 100, 50]);
});

test("splitMessage: a table written without the outer pipes also keeps its header", () => {
  const head = "Name | Hours\n--- | ---:";
  const rows = Array.from({ length: 60 }, (_, i) => `Person ${i} | ${i}.5`);
  const parts = splitMessage(`${head}\n${rows.join("\n")}`, 300);
  assert.ok(parts.length > 1);
  for (const p of parts) assert.ok(p.startsWith(head));
  assert.deepEqual(parts.flatMap((p) => p.split("\n").slice(2)), rows);
});

test("splitMessage: a long paragraph with a dash line is not mistaken for a table", () => {
  const text = `Title | sub\n-----\n${"line of text\n".repeat(40).trim()}`;
  const parts = splitMessage(text, 200);
  assert.equal(parts.join("\n"), text);
});

test("splitMessage: a table right under a heading keeps its real header in every part", () => {
  const head = "| Name | Hours |\n| :--- | ---: |";
  const rows = Array.from({ length: 60 }, (_, i) => `| Person ${i} | ${i}.5 |`);
  const text = `## Team hours\n${head}\n${rows.join("\n")}\nTotal: 60 people`;
  const parts = splitMessage(text, 300);
  assert.ok(parts.every((p) => p.length <= 300));
  assert.ok(parts[0].startsWith(`## Team hours\n${head}`));
  for (const p of parts.slice(1, -1)) assert.ok(p.startsWith(head));
  assert.deepEqual(parts.flatMap((p) => p.split("\n").filter((l) => l.startsWith("| Person"))), rows);
  assert.ok(parts.at(-1)!.endsWith("Total: 60 people"));
  assert.equal(parts.join("\n").split(head).length - 1, parts.filter((p) => p.includes("| Person")).length, "the header once per part that has rows");
});

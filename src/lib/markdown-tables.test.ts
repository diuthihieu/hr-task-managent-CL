import { test } from "node:test";
import assert from "node:assert/strict";
import { repairTables } from "./markdown-tables";

test("a table with its header is left alone", () => {
  const md = "Intro\n\n| a | b |\n|---|---|\n| 1 | 2 |";
  assert.equal(repairTables(md), md);
});

test("rows without a header get an empty header row", () => {
  const md = "| C&B | Task A | 95% |\n| L&D | Task B | 0% |";
  const out = repairTables(md).split("\n");
  assert.equal(out[0], "| | | |");
  assert.equal(out[1], "| --- | --- | --- |");
  assert.equal(out[2], "| C&B | Task A | 95% |");
});

test("the cut tail of a row before headerless rows joins the table", () => {
  const md = "email gửi Quản lý. |\n| L&D | Follow AWS | 0% |\n\n## Done";
  const out = repairTables(md).split("\n");
  assert.deepEqual(out.slice(0, 4), ["| | | |", "| --- | --- | --- |", "| email gửi Quản lý. |", "| L&D | Follow AWS | 0% |"]);
  assert.ok(out.includes("## Done"));
});

test("text before headerless rows is separated by a blank line", () => {
  const out = repairTables("Some text\n| a | b |").split("\n");
  assert.deepEqual(out, ["Some text", "", "| | |", "| --- | --- |", "| a | b |"]);
});

test("pipes inside code fences are untouched", () => {
  const md = "```\n| a | b |\n```";
  assert.equal(repairTables(md), md);
});

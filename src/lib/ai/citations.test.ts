import { test } from "node:test";
import assert from "node:assert/strict";
import { CitationLinker, linkCitations, taskRef } from "./citations";

const id = "1a2b3c4d-0000-4000-8000-000000000001";
const id2 = "5e6f7a8b-0000-4000-8000-000000000002";
const refs = new Map([
  [taskRef(id), { url: `/w/acme/p/p1/t/${id}`, title: 'C&B › Hồ sơ "offboard"' }],
  [taskRef(id2), { url: `/w/acme/p/p1/t/${id2}`, title: "L&D › AWS" }],
]);

test("taskRef is short and stable", () => {
  assert.equal(taskRef(id), "T-1a2b3c4d");
});

test("known refs become links, unknown refs are dropped", () => {
  assert.equal(linkCitations("Done [T-1a2b3c4d].", refs), `Done [↗](/w/acme/p/p1/t/${id} "C&B › Hồ sơ  offboard ").`);
  assert.equal(linkCitations("x [T-deadbeef] y", refs), "x  y");
  assert.equal(linkCitations("[T-1A2B3C4D, T-5e6f7a8b]", refs).match(/\[↗\]/g)?.length, 2);
  assert.equal(linkCitations("[link](http://x) [1] [T-12]", refs), "[link](http://x) [1] [T-12]");
});

test("a ref split across stream chunks is still linked", () => {
  const l = new CitationLinker(refs);
  const out = l.push("Status ok [T-1a2") + l.push("b3c4d] next [") + l.push("note] end") + l.flush();
  assert.equal(out, `Status ok [↗](/w/acme/p/p1/t/${id} "C&B › Hồ sơ  offboard ") next [note] end`);
});

test("an unfinished bracket at the end is flushed as is", () => {
  const l = new CitationLinker(refs);
  assert.equal(l.push("a [T-1a") + l.flush(), "a [T-1a");
});

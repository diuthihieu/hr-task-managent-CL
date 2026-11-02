import { test } from "node:test";
import assert from "node:assert/strict";
import { pageArgs, readPage, toPage } from "../pagination";

const req = (q: string) => new Request(`http://x/api/list${q}`);
const ID = "0b5c0b8e-6a0e-4f6c-9a5e-0d6b3b7a1c11";

test("readPage: default 100, max 500, the cursor must be an id", () => {
  assert.deepEqual(readPage(req("")), { limit: 100, cursor: undefined });
  assert.deepEqual(readPage(req(`?limit=5&cursor=${ID}`)), { limit: 5, cursor: ID });
  for (const bad of ["?limit=0", "?limit=501", "?limit=abc", "?cursor=2026-01-01T00:00:00.000Z"]) assert.throws(() => readPage(req(bad)), /Invalid paging/, bad);
});

test("pageArgs asks for one extra row and starts after the cursor row", () => {
  assert.deepEqual(pageArgs({ limit: 10 }), { take: 11 });
  assert.deepEqual(pageArgs({ limit: 10, cursor: ID }), { cursor: { id: ID }, skip: 1, take: 11 });
});

test("toPage: nextCursor is the last returned id only when another row exists", () => {
  const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(toPage(rows, { limit: 2 }), { items: [{ id: "a" }, { id: "b" }], nextCursor: "b" });
  assert.deepEqual(toPage(rows, { limit: 3 }), { items: rows, nextCursor: null });
});

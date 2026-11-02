import { test } from "node:test";
import assert from "node:assert/strict";
import { field, record } from "./helpers";
import { resolveComputedFields } from "../../server/tasks/read";
import { LINKED_SET_MAX_QUERIES, collectLinkedTaskIds, computedLinkFields, linksOf } from "../../server/tasks/linked-set";
import type { RecordRow } from "@/types";

// BUG-07: an edit recomputes lookups / rollups from the tasks reachable through the links those
// fields follow, not from the whole project.
const LINK = "f_link";
const title = field("sys_title", "Title", "text");
const link = field(LINK, "Related", "link");
const f1 = field("f1", "L1", "lookup", { lookupLinkFieldId: LINK });
const f2 = field("f2", "L2", "lookup", { lookupLinkFieldId: LINK, lookupFieldId: "f1" });
const f3 = field("f3", "L3", "lookup", { lookupLinkFieldId: LINK, lookupFieldId: "f2" });
const count = field("r1", "Count", "rollup", { lookupLinkFieldId: LINK, rollupFn: "count" });

/** In-memory "database": the loader only returns ids that exist, like the real query. */
function graph(records: RecordRow[], fields = [title, link, count]) {
  const follow = computedLinkFields(fields);
  const byId = new Map(records.map((r) => [r.id, r]));
  const calls: string[][] = [];
  const load = async (ids: string[]) => {
    calls.push(ids);
    return ids.flatMap((id) => (byId.has(id) ? [{ id, links: linksOf(byId.get(id)!, follow) }] : []));
  };
  return { follow, load, calls, start: (id: string) => ({ id, links: linksOf(byId.get(id)!, follow) }) };
}

function project(n: number) {
  const rows = Array.from({ length: n }, (_, i) => record(`t${i}`, { sys_title: `T${i}`, [LINK]: [] }, i));
  rows[0].data[LINK] = ["t1", "t2", "t3"];
  return rows;
}

test("only the 3 linked tasks are looked up, however big the project", async () => {
  for (const n of [1000, 5000]) {
    const g = graph(project(n));
    const ids = await collectLinkedTaskIds(g.start("t0"), g.load);
    assert.deepEqual([...ids!].sort(), ["t0", "t1", "t2", "t3"]);
    assert.equal(g.calls.flat().length, 3, `${n} tasks: 3 ids loaded`);
  }
});

test("a long chain of links stops after a few queries and asks for the old full load", async () => {
  const rows = Array.from({ length: 1000 }, (_, i) => record(`t${i}`, { sys_title: `T${i}`, [LINK]: i < 999 ? [`t${i + 1}`] : [] }, i));
  const g = graph(rows);
  assert.equal(await collectLinkedTaskIds(g.start("t0"), g.load), null);
  assert.ok(g.calls.length <= LINKED_SET_MAX_QUERIES, `${g.calls.length} sequential queries`);
});

test("past the limit it stops and asks for the old full load", async () => {
  const rows = Array.from({ length: 50 }, (_, i) => record(`t${i}`, { sys_title: `T${i}`, [LINK]: i < 49 ? [`t${i + 1}`] : [] }, i));
  const g = graph(rows);
  assert.equal(await collectLinkedTaskIds(g.start("t0"), g.load, 10), null);
  assert.ok(g.calls.flat().length < 10, "stopped before loading the rest");
});

function sameAsFull(rows: RecordRow[], fields: ReturnType<typeof field>[], startId: string) {
  return (async () => {
    const full = resolveComputedFields(structuredClone(rows), fields).find((r) => r.id === startId)!;
    const g = graph(rows, fields);
    const ids = (await collectLinkedTaskIds(g.start(startId), g.load))!;
    const subset = resolveComputedFields(structuredClone(rows.filter((r) => ids.has(r.id))), fields).find((r) => r.id === startId)!;
    assert.deepEqual(subset.data, full.data);
  })();
}

test("chained lookups (A→B→C→D) and cycles give the same values on the subset as on the whole project", async () => {
  const fields = [title, link, f1, f2, f3, count];
  const chain = ["A", "B", "C", "D"].map((id, i, all) => record(id, { sys_title: id, [LINK]: all[i + 1] ? [all[i + 1]] : [] }, i));
  const noise = Array.from({ length: 200 }, (_, i) => record(`n${i}`, { sys_title: `N${i}`, [LINK]: [`n${(i + 1) % 200}`] }, 10 + i));
  for (const order of [chain, [...chain].reverse()]) for (const id of ["A", "B", "C"]) await sameAsFull([...noise.slice(0, 100), ...order, ...noise.slice(100)], fields, id);
  const cycle = ["X", "Y", "Z"].map((id, i, all) => record(id, { sys_title: id, [LINK]: [all[(i + 1) % 3], "missing-id"] }, i));
  for (const id of ["X", "Y", "Z"]) await sameAsFull([...cycle, ...noise], fields, id);
});

test("row order still decides 3-level lookups, as before (pinned current behaviour)", () => {
  const fields = [title, link, f1, f2, f3];
  const mk = () => ["A", "B", "C", "D"].map((id, i, all) => record(id, { sys_title: id, [LINK]: all[i + 1] ? [all[i + 1]] : [] }, i));
  const forward = resolveComputedFields(mk(), fields).find((r) => r.id === "A")!;
  const backward = resolveComputedFields(mk().reverse(), fields).find((r) => r.id === "A")!;
  assert.deepEqual(forward.data.f3, []);
  assert.deepEqual(backward.data.f3, ["D"]);
  assert.deepEqual(forward.data.f2, ["C"]);
  assert.deepEqual(backward.data.f2, ["C"]);
});

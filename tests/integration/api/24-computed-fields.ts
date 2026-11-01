import { test } from "node:test";
import assert from "node:assert/strict";
import { admin, s, type Rec } from "./context";

// BUG-07: after an edit, lookups / rollups are recomputed from the linked tasks only. Regression
// guard (the test project is small, so this proves correctness, not speed).
test("edits and a 50-row insert in a project with lookups and rollups return the right values", async () => {
  const P = (await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/projects`, { name: "Computed fields" })).body.id;
  const link = (await admin.post<{ id: string }>(`/api/projects/${P}/custom-fields`, { name: "Related", type: "link" })).body.id;
  const est = (await admin.post<{ id: string }>(`/api/projects/${P}/custom-fields`, { name: "Points", type: "number" })).body.id;
  const count = await admin.post<{ id: string }>(`/api/projects/${P}/custom-fields`, { name: "Linked", type: "rollup", config: { lookupLinkFieldId: link, rollupFn: "count" } });
  assert.equal(count.status, 201, JSON.stringify(count.body));
  const sum = (await admin.post<{ id: string }>(`/api/projects/${P}/custom-fields`, { name: "Points linked", type: "rollup", config: { lookupLinkFieldId: link, lookupFieldId: est, rollupFn: "sum" } })).body.id;
  const titles = (await admin.post<{ id: string }>(`/api/projects/${P}/custom-fields`, { name: "Linked titles", type: "lookup", config: { lookupLinkFieldId: link } })).body.id;
  const parentTitle = (await admin.post<{ id: string }>(`/api/projects/${P}/custom-fields`, { name: "Parent", type: "lookup", config: { lookupLinkFieldId: "sys_parent" } })).body.id;

  const mk = async (data: Record<string, unknown>) => (await admin.post<Rec>(`/api/projects/${P}/tasks`, { data })).body;
  const a = await mk({ sys_title: "A", [est]: 2 });
  const b = await mk({ sys_title: "B", [est]: 3 });
  for (let i = 0; i < 20; i++) await mk({ sys_title: `noise ${i}`, [est]: 100 });
  const target = await mk({ sys_title: "PERF-TARGET", [link]: [a.id, b.id] });
  assert.equal(target.data[count.body.id], 2);
  assert.equal(target.data[sum], 5);
  assert.deepEqual(target.data[titles], ["A", "B"]);

  const edited = await admin.patch<Rec>(`/api/tasks/${target.id}`, { data: { sys_title: "PERF-TARGET 2" } });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.data[sum], 5, "rollup still computed after an edit");
  await admin.patch(`/api/tasks/${a.id}`, { data: { [est]: 10 } });
  assert.equal((await admin.get<Rec>(`/api/tasks/${target.id}`)).body.data[sum], 13, "picks up the linked task's new value");

  const child = await mk({ sys_title: "Child", sys_parent: [target.id] });
  assert.deepEqual(child.data[parentTitle], ["PERF-TARGET 2"], "lookup through sys_parent");

  const ins = await admin.post<{ records: Rec[] }>(`/api/projects/${P}/tasks/insert`, { anchorId: target.id, position: "below", count: 50, data: { sys_title: "Row", [link]: [b.id] } });
  assert.equal(ins.status, 201, JSON.stringify(ins.body));
  assert.equal(ins.body.records.length, 50);
  assert.ok(ins.body.records.every((r) => r.data[count.body.id] === 1 && r.data[sum] === 3));
});

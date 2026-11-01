import { test } from "node:test";
import assert from "node:assert/strict";
import { admin, s, type Rec } from "./context";

type Conflict = { parentId: string; parentTitle: string; estimate: { current: number; min: number } | null; actual: { current: number; min: number } | null };

// U7: a parent's hours include its sub-tasks', so they must be at least their total. A save that
// breaks this returns `hoursConflict`, and the client asks the user to correct the parent.
test("a save that puts sub-tasks above their parent's hours reports the conflict", async () => {
  const P = (await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/projects`, { name: "Hours rule" })).body.id;
  const parent = (await admin.post<Rec>(`/api/projects/${P}/tasks`, { data: { sys_title: "Payroll October", sys_estimate: 4, sys_actual: 3 } })).body;
  const a = await admin.post<Rec & { hoursConflict?: Conflict }>(`/api/projects/${P}/tasks`, { data: { sys_title: "IT payroll", sys_parent: [parent.id], sys_estimate: 2, sys_actual: 2 } });
  assert.equal(a.status, 201);
  assert.equal(a.body.hoursConflict, undefined, "2 h of 4 h / 3 h: fine");

  const b = await admin.post<Rec & { hoursConflict?: Conflict }>(`/api/projects/${P}/tasks`, { data: { sys_title: "HR payroll", sys_parent: [parent.id], sys_estimate: 1, sys_actual: 1.5 } });
  assert.deepEqual(b.body.hoursConflict, { parentId: parent.id, parentTitle: "Payroll October", estimate: null, actual: { current: 3, min: 3.5 } }, "actual 2 + 1.5 > 3");

  const edit = await admin.patch<Rec & { hoursConflict?: Conflict }>(`/api/tasks/${a.body.id}`, { data: { sys_estimate: 3.5 } });
  assert.deepEqual(edit.body.hoursConflict?.estimate, { current: 4, min: 4.5 });

  const lowerParent = await admin.patch<Rec & { hoursConflict?: Conflict }>(`/api/tasks/${parent.id}`, { data: { sys_estimate: 5, sys_actual: 2 } });
  assert.deepEqual(lowerParent.body.hoursConflict, { parentId: parent.id, parentTitle: "Payroll October", estimate: null, actual: { current: 2, min: 3.5 } }, "editing the parent itself is checked too");

  const fixed = await admin.patch<Rec & { hoursConflict?: Conflict }>(`/api/tasks/${parent.id}`, { data: { sys_estimate: 4.5, sys_actual: 3.5 } });
  assert.equal(fixed.body.hoursConflict, undefined);
  assert.equal((await admin.patch<Rec & { hoursConflict?: Conflict }>(`/api/tasks/${parent.id}`, { data: { sys_title: "Payroll Oct" } })).body.hoursConflict, undefined, "other edits aren't checked");

  // A parent with no hours entered is left alone.
  const empty = (await admin.post<Rec>(`/api/projects/${P}/tasks`, { data: { sys_title: "Container" } })).body;
  assert.equal((await admin.post<Rec & { hoursConflict?: Conflict }>(`/api/projects/${P}/tasks`, { data: { sys_title: "Child", sys_parent: [empty.id], sys_actual: 2 } })).body.hoursConflict, undefined);
});

test("the least parent hours are worked out from stored minutes, so saving that value clears the conflict", async () => {
  const P = (await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/projects`, { name: "Hours minutes" })).body.id;
  const parent = (await admin.post<Rec>(`/api/projects/${P}/tasks`, { data: { sys_title: "Short calls", sys_actual: 0.05 } })).body; // 3 min
  let conflict: Conflict | undefined;
  for (let i = 0; i < 3; i++) conflict = (await admin.post<Rec & { hoursConflict?: Conflict }>(`/api/projects/${P}/tasks`, { data: { sys_title: `Call ${i}`, sys_parent: [parent.id], sys_actual: 0.0334 } })).body.hoursConflict; // 2 min each
  assert.deepEqual(conflict?.actual, { current: 0.05, min: 0.1 }, "6 min -> 0.1 h (rounded up), not 3 x 0.03 = 0.09 h");
  const fixed = await admin.patch<Rec & { hoursConflict?: Conflict }>(`/api/tasks/${parent.id}`, { data: { sys_actual: conflict!.actual!.min } });
  assert.equal(fixed.body.hoursConflict, undefined, "the suggested value is enough once stored in minutes");
});

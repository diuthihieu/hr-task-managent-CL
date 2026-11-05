import { test } from "node:test";
import assert from "node:assert/strict";
import { admin, s, prisma, lastModelRequest, type Rec } from "./context";

// U1: an hours report read 0 because the dashboard's chart had lost its value field. The report now
// gets the hours from the tasks themselves, and a misconfigured chart says so instead of showing 0.
test("hours reports use the tasks' hours (each assignee in full, parents once); a chart without a value field reports an error", async () => {
  // Two active members of their own (earlier chapters deactivate some of the shared test users).
  const mk = async (name: string) => {
    const u = await prisma.user.create({ data: { email: `${name.toLowerCase()}.hours@integration.test`, name, systemRole: "MEMBER", passwordHash: "x", mustChangePassword: false, emailVerifiedAt: new Date() } });
    await prisma.workspaceMember.create({ data: { workspaceId: s.ws, userId: u.id, role: "editor" } });
    return u.id;
  };
  const hieu = await mk("Hieu");
  const tam = await mk("Tam");
  const P = (await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/projects`, { name: "WBS hours", categories: [{ name: "Payroll" }] })).body.id;
  const cat = (await admin.get<{ id: string; name: string }[]>(`/api/projects/${P}/categories`)).body.find((c) => c.name === "Payroll")!.id;
  const shared = await admin.post<Rec>(`/api/projects/${P}/tasks`, { data: { sys_title: "Shared", sys_category: cat, sys_assignees: [hieu, tam], sys_actual: 6, sys_due_date: "2026-10-15" } });
  assert.equal(shared.status, 201, JSON.stringify(shared.body));
  const parent = (await admin.post<Rec>(`/api/projects/${P}/tasks`, { data: { sys_title: "Parent", sys_category: cat, sys_assignees: [hieu], sys_actual: 5, sys_due_date: "2026-10-20" } })).body;
  await admin.post(`/api/projects/${P}/tasks`, { data: { sys_title: "Child", sys_parent: [parent.id], sys_category: cat, sys_assignees: [hieu], sys_actual: 2, sys_due_date: "2026-10-20" } });

  const d = await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/dashboards`, { name: "Hours" });
  const broken = await admin.post<{ id: string }>(`/api/dashboards/${d.body.id}/blocks`, { type: "column", title: "Actual hours by category", config: { dataSource: { projectId: P }, aggregation: "sum" } });
  const data = await admin.post<{ error?: string }>(`/api/dashboard-blocks/${broken.body.id}/data`, {});
  assert.match(data.body.error ?? "", /value field/, "no silent 0");

  const r = await admin.post("/api/ai/report", { targetKind: "dashboard", targetId: d.body.id, prompt: "Hours by category and member for October", data: "## Actual hours by category (column)\n(error: Choose the value field to sum (Edit widget))", charts: [] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const prompt = (await lastModelRequest()).body.systemInstruction!.parts[0].text;
  assert.match(prompt, /Hours per person, category and month/);
  const row = (person: string) => prompt.split("\n").find((l) => l.startsWith(`${person} | Payroll | 2026-10 |`)) ?? "";
  // person | category | month | tasks | estimate h | actual h | actual h of done tasks
  assert.equal(row("Hieu").split(" | ")[5], "11", "6 shared + 5 parent total (3 own + 2 child) = 11");
  assert.equal(row("Tam").split(" | ")[5], "6", "the other assignee gets the full 6 hours too");
  // Pre-computed totals on both bases, so the model never adds rows up or mixes the bases.
  assert.match(prompt, /Pre-computed totals/);
  assert.match(prompt, /never mixed/);
  const line = (start: string) => prompt.split("\n").find((l) => l.startsWith(start)) ?? "";
  assert.equal(line("2026-10 | 3 |").split(" | ")[4], "11", "team actual counts the shared task once: 6 + 3 + 2");
  assert.deepEqual(line("2026-10 | 4 |").split(" | ").slice(3), ["17", "11", "1", "6"], "person-hours 11 + 6 = 17; one shared task adds 6 h");
});

test("time focused on a sub-task also counts for its parent (a parent's hours include its sub-tasks')", async () => {
  const P = (await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/projects`, { name: "Focus roll-up" })).body.id;
  const top = (await admin.post<Rec>(`/api/projects/${P}/tasks`, { data: { sys_title: "Top", sys_actual: 1 } })).body;
  const mid = (await admin.post<Rec>(`/api/projects/${P}/tasks`, { data: { sys_title: "Mid", sys_parent: [top.id] } })).body;
  const leaf = (await admin.post<Rec>(`/api/projects/${P}/tasks`, { data: { sys_title: "Leaf", sys_parent: [mid.id] } })).body;
  const f = await admin.post<{ id: string }>(`/api/tasks/${leaf.id}/focus`, {});
  assert.equal(f.status, 201, JSON.stringify(f.body));
  await prisma.focusSession.update({ where: { id: f.body.id }, data: { elapsedSeconds: 30 * 60, resumedAt: new Date() } });
  assert.equal((await admin.patch(`/api/focus/${f.body.id}`, { action: "complete" })).status, 200);
  const minutes = async (id: string) => (await prisma.task.findUniqueOrThrow({ where: { id }, select: { actualMinutes: true } })).actualMinutes;
  assert.equal(await minutes(leaf.id), 30);
  assert.equal(await minutes(mid.id), 30);
  assert.equal(await minutes(top.id), 90, "1 h logged before + 30 min of the sub-task");
});

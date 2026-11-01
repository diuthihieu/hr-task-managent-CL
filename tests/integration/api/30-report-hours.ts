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
  assert.equal(row("Hieu").split(" | ").at(-1), "11", "6 shared + 5 parent total (3 own + 2 child) = 11");
  assert.equal(row("Tam").split(" | ").at(-1), "6", "the other assignee gets the full 6 hours too");
});

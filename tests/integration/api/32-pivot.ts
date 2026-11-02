import { test } from "node:test";
import assert from "node:assert/strict";
import { admin, s, prisma, type Rec } from "./context";

// U8a: a summary table widget - hours per assignee and category, each assignee in full.
test("summary table widget: rows x columns x hours, with totals", async () => {
  const mk = async (name: string) => {
    const u = await prisma.user.create({ data: { email: `${name.toLowerCase()}.pivot@integration.test`, name, systemRole: "MEMBER", passwordHash: "x", mustChangePassword: false, emailVerifiedAt: new Date() } });
    await prisma.workspaceMember.create({ data: { workspaceId: s.ws, userId: u.id, role: "editor" } });
    return u.id;
  };
  const [an, binh] = [await mk("An"), await mk("Binh")];
  const P = (await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/projects`, { name: "Pivot hours", categories: [{ name: "Payroll" }, { name: "Recruit" }] })).body.id;
  const cats = (await admin.get<{ id: string; name: string }[]>(`/api/projects/${P}/categories`)).body;
  const cat = (n: string) => cats.find((c) => c.name === n)!.id;
  await admin.post<Rec>(`/api/projects/${P}/tasks`, { data: { sys_title: "Shared", sys_category: cat("Payroll"), sys_assignees: [an, binh], sys_actual: 6 } });
  await admin.post<Rec>(`/api/projects/${P}/tasks`, { data: { sys_title: "Hiring", sys_category: cat("Recruit"), sys_assignees: [an], sys_actual: 2 } });

  const d = await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/dashboards`, { name: "Hours table" });
  const w = await admin.post<{ id: string }>(`/api/dashboards/${d.body.id}/blocks`, { type: "pivot", title: "Hours", config: { dataSource: { projectId: P }, dimensionFieldId: "sys_assignees", dimension2FieldId: "sys_category", measureFieldId: "sys_actual", aggregation: "sum" } });
  assert.equal(w.status, 201, JSON.stringify(w.body));
  const r = await admin.post<{ pivot: { rows: { label: string }[]; cols: { label: string }[]; cells: number[][]; rowTotals: number[]; total: number } }>(`/api/dashboard-blocks/${w.body.id}/data`, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.pivot.rows.map((x) => x.label), ["An", "Binh"]);
  assert.deepEqual(r.body.pivot.cols.map((x) => x.label), ["Payroll", "Recruit"]);
  assert.deepEqual(r.body.pivot.cells, [[6, 2], [6, 0]]);
  assert.deepEqual(r.body.pivot.rowTotals, [8, 6]);
  assert.equal(r.body.pivot.total, 14);

  const noRows = await admin.post<{ id: string }>(`/api/dashboards/${d.body.id}/blocks`, { type: "pivot", title: "Empty", config: { dataSource: { projectId: P }, aggregation: "count" } });
  assert.match((await admin.post<{ error?: string }>(`/api/dashboard-blocks/${noRows.body.id}/data`, {})).body.error ?? "", /rows/);
});

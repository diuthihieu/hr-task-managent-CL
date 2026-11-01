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

test("Append stacks two projects into one summary table; Merge adds another project's column by a key; sources are checked", async () => {
  const proj = async (name: string) => (await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/projects`, { name })).body.id;
  const [hr, it, staff] = [await proj("Append HR"), await proj("Append IT"), await proj("Staff list")];
  const code = async (p: string) => (await admin.post<{ id: string }>(`/api/projects/${p}/custom-fields`, { name: "Code", type: "text" })).body.id;
  const [hrCode, itCode, staffCode] = [await code(hr), await code(it), await code(staff)];
  const dept = (await admin.post<{ id: string }>(`/api/projects/${staff}/custom-fields`, { name: "Department", type: "text" })).body.id;
  await admin.post(`/api/projects/${hr}/tasks`, { data: { sys_title: "Payroll", sys_actual: 3, [hrCode]: "NV01" } });
  await admin.post(`/api/projects/${it}/tasks`, { data: { sys_title: "Server", sys_actual: 4, [itCode]: "nv02" } });
  await admin.post(`/api/projects/${staff}/tasks`, { data: { sys_title: "An", [staffCode]: "nv01", [dept]: "Finance" } });
  await admin.post(`/api/projects/${staff}/tasks`, { data: { sys_title: "Binh", [staffCode]: "NV02", [dept]: "IT" } });

  const d = await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/dashboards`, { name: "Combined" });
  const byProject = await admin.post<{ id: string }>(`/api/dashboards/${d.body.id}/blocks`, { type: "pivot", title: "By project", config: { dataSource: { projectId: hr, appendProjectIds: [it] }, dimensionFieldId: "__project", measureFieldId: "sys_actual", aggregation: "sum" } });
  const a = await admin.post<{ pivot: { rows: { label: string }[]; cells: number[][]; total: number } }>(`/api/dashboard-blocks/${byProject.body.id}/data`, {});
  assert.deepEqual([a.body.pivot.rows.map((r) => r.label), a.body.pivot.cells, a.body.pivot.total], [["Append HR", "Append IT"], [[3], [4]], 7]);

  const byDept = await admin.post<{ id: string }>(`/api/dashboards/${d.body.id}/blocks`, {
    type: "pivot",
    title: "By department",
    config: { dataSource: { projectId: hr, appendProjectIds: [it], merge: { projectId: staff, leftFieldId: hrCode, rightFieldId: staffCode, fieldIds: [dept] } }, dimensionFieldId: `m:${dept}`, measureFieldId: "sys_actual", aggregation: "sum" },
  });
  const m = await admin.post<{ pivot: { rows: { label: string }[]; cells: number[][] } }>(`/api/dashboard-blocks/${byDept.body.id}/data`, {});
  assert.deepEqual([m.body.pivot.rows.map((r) => r.label), m.body.pivot.cells], [["Finance", "IT"], [[3], [4]]], "codes matched across projects, case-insensitively (the IT task's Code joins by name)");

  const other = (await admin.post<{ id: string }>("/api/workspaces", { name: "Other company" })).body.id;
  const foreign = (await admin.post<{ id: string }>(`/api/workspaces/${other}/projects`, { name: "Foreign" })).body.id;
  assert.equal((await admin.post(`/api/dashboards/${d.body.id}/blocks`, { type: "pivot", title: "x", config: { dataSource: { projectId: hr, appendProjectIds: [foreign] }, dimensionFieldId: "__project" } })).status, 400, "no projects from another workspace");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { admin, viewer, s, prisma } from "./context";

// D3: dashboard slicers work like Power BI's - one filter state for every widget, OR inside a slicer,
// AND between slicers, inclusive date ranges, "no data" instead of an unfiltered fallback, and
// options linked to the other slicers (only from projects the viewer may see).
test("slicers filter every widget of a dashboard like Power BI, and their options follow the other slicers", async () => {
  const mk = async (name: string) => {
    const u = await prisma.user.create({ data: { email: `${name.toLowerCase()}.slicer@integration.test`, name, systemRole: "MEMBER", passwordHash: "x", mustChangePassword: false, emailVerifiedAt: new Date() } });
    await prisma.workspaceMember.create({ data: { workspaceId: s.ws, userId: u.id, role: "editor" } });
    return u.id;
  };
  const [cuc, dung] = [await mk("Cuc"), await mk("Dung")];
  const P = (await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/projects`, { name: "Slicer data", categories: [{ name: "Payroll" }, { name: "Recruit" }] })).body.id;
  const cats = (await admin.get<{ id: string; name: string }[]>(`/api/projects/${P}/categories`)).body;
  const cat = (n: string) => cats.find((c) => c.name === n)!.id;
  const task = (title: string, category: string, assignees: string[], actual: number, due: string) =>
    admin.post(`/api/projects/${P}/tasks`, { data: { sys_title: title, sys_category: cat(category), sys_assignees: assignees, sys_actual: actual, sys_due_date: due } });
  await task("Oct payroll", "Payroll", [cuc], 4, "2026-10-01");
  await task("Hiring", "Recruit", [cuc, dung], 6, "2026-10-15");
  await task("Nov payroll", "Payroll", [dung], 3, "2026-10-31");
  const hidden = (await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/projects`, { name: "Slicer secret", categories: [{ name: "Secret cat" }] })).body.id;
  const hcat = (await admin.get<{ id: string; name: string }[]>(`/api/projects/${hidden}/categories`)).body[0].id;
  await admin.post(`/api/projects/${hidden}/tasks`, { data: { sys_title: "Secret", sys_category: hcat, sys_actual: 9 } });
  await prisma.projectHiddenMember.create({ data: { projectId: hidden, userId: s.viewerId } });

  const d = (await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/dashboards`, { name: "Slicers" })).body.id;
  const kpi = (await admin.post<{ id: string }>(`/api/dashboards/${d}/blocks`, { type: "kpi", title: "Hours", config: { dataSource: { projectId: P, appendProjectIds: [hidden] }, measureFieldId: "sys_actual", aggregation: "sum" } })).body.id;
  const pivot = (await admin.post<{ id: string }>(`/api/dashboards/${d}/blocks`, { type: "pivot", title: "By person", config: { dataSource: { projectId: P }, dimensionFieldId: "sys_assignees", measureFieldId: "sys_actual", aggregation: "sum" } })).body.id;
  type Out = { kpi?: number; pivot?: { rows: { label: string }[]; cells: number[][] }; empty?: boolean };
  const data = async (id: string, slicers: unknown[], client = admin) => (await client.post<Out>(`/api/dashboard-blocks/${id}/data`, { slicers })).body;

  assert.equal((await data(kpi, [])).kpi, 22, "no slicer: everything (13 + 9 from the appended project)");
  assert.equal((await data(kpi, [{ fieldName: "Category", values: [] }])).kpi, 22, "an empty slicer filters nothing");
  assert.equal((await data(kpi, [{ fieldName: "Category", values: ["Payroll", "Secret cat"] }])).kpi, 16, "OR inside a slicer (4 + 3 + 9)");
  assert.equal((await data(kpi, [{ fieldName: "Category", values: ["Payroll"] }, { fieldName: "Assignees", values: ["Dung"] }])).kpi, 3, "AND between slicers");
  const p = await data(pivot, [{ fieldName: "category", values: ["recruit"] }]);
  assert.deepEqual([p.pivot!.rows.map((r) => r.label), p.pivot!.cells], [["Cuc", "Dung"], [[6], [6]]], "the same filter state reaches the table");
  assert.equal((await data(kpi, [{ fieldName: "Due date", from: "2026-10-01", to: "2026-10-15" }])).kpi, 10, "date range includes both ends");
  const none = await data(kpi, [{ fieldName: "Category", values: ["Payroll"] }, { fieldName: "Assignees", values: ["Cuc"] }, { fieldName: "Due date", from: "2026-10-02" }]);
  assert.deepEqual([none.kpi, none.empty], [0, true], "a combination with no data says so - the selection isn't dropped");
  assert.equal((await data(kpi, [{ fieldName: "Category", label: "Recruit", operator: "is" }])).kpi, 6, "an old saved slicer still works");

  type Options = { found: boolean; kind: string; values: { label: string; count: number }[]; min?: string; max?: string };
  const options = async (fieldName: string, slicers: unknown[], client = admin) => (await client.post<Options>(`/api/dashboards/${d}/slicer-options`, { fieldName, slicers })).body;
  const all = await options("Category", []);
  assert.deepEqual(all.values, [{ label: "Payroll", count: 2 }, { label: "Recruit", count: 1 }, { label: "Secret cat", count: 1 }]);
  const linked = await options("Category", [{ fieldName: "Assignees", values: ["Dung"] }, { fieldName: "Category", values: ["Payroll"] }]);
  assert.deepEqual(linked.values, [{ label: "Payroll", count: 1 }, { label: "Recruit", count: 1 }], "linked to Assignees, not narrowed by its own selection");
  const dates = await options("Due date", [{ fieldName: "Assignees", values: ["Dung"] }]);
  assert.deepEqual([dates.kind, dates.min, dates.max], ["date", "2026-10-15", "2026-10-31"]);
  const seen = await options("Category", [], viewer);
  assert.deepEqual(seen.values.map((v) => v.label), ["Payroll", "Recruit"], "a project hidden from the viewer gives no slicer values");
  assert.equal((await data(kpi, [], viewer)).kpi, 13);
  assert.equal((await admin.post(`/api/dashboards/${d}/slicer-options`, { fieldName: "" })).status, 400);
});

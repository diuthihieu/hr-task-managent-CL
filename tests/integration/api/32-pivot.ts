import { test } from "node:test";
import assert from "node:assert/strict";
import { admin, viewer, s, prisma, lastModelRequest, type Rec } from "./context";

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

// A team dashboard is computed for whoever looks at it: a project hidden from the viewer never reaches
// them, even when the author (who sees everything) appended it - and the viewer is told some sources
// are left out, so a smaller total isn't mistaken for the whole picture.
test("a team dashboard shows each viewer only the projects they may see, and says when a source is left out", async () => {
  const proj = async (name: string) => (await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/projects`, { name })).body.id;
  const [open, secret] = [await proj("Visible to all"), await proj("Hidden from viewer")];
  await admin.post(`/api/projects/${open}/tasks`, { data: { sys_title: "Open work", sys_actual: 2 } });
  await admin.post(`/api/projects/${secret}/tasks`, { data: { sys_title: "Secret work", sys_actual: 5 } });
  await prisma.projectHiddenMember.create({ data: { projectId: secret, userId: s.viewerId } });

  const d = await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/dashboards`, { name: "Team hours" });
  const w = await admin.post<{ id: string }>(`/api/dashboards/${d.body.id}/blocks`, { type: "pivot", title: "By project", config: { dataSource: { projectId: open, appendProjectIds: [secret] }, dimensionFieldId: "__project", measureFieldId: "sys_actual", aggregation: "sum" } });
  type Out = { pivot: { rows: { label: string }[]; total: number }; hiddenSources?: number };
  const author = await admin.post<Out>(`/api/dashboard-blocks/${w.body.id}/data`, {});
  assert.deepEqual([author.body.pivot.rows.map((r) => r.label), author.body.pivot.total, author.body.hiddenSources ?? 0], [["Hidden from viewer", "Visible to all"], 7, 0]);

  const seen = await viewer.post<Out>(`/api/dashboard-blocks/${w.body.id}/data`, {});
  assert.equal(seen.status, 200, JSON.stringify(seen.body));
  assert.ok(seen.body.pivot, `the widget still works without the hidden source: ${JSON.stringify(seen.body)}`);
  assert.deepEqual([seen.body.pivot.rows.map((r) => r.label), seen.body.pivot.total], [["Visible to all"], 2], "the hidden project's tasks and name never reach the viewer");
  assert.equal(seen.body.hiddenSources, 1, "the viewer is told one source is left out");
  assert.doesNotMatch(JSON.stringify(seen.body), /Secret work|Hidden from viewer/);

  const drill = await viewer.post<{ tasks: { title: string }[] }>(`/api/dashboard-blocks/${w.body.id}/records`, { segment: { key: "Hidden from viewer", label: "Hidden from viewer" } });
  assert.deepEqual(drill.body.tasks, [], "drill-down can't reach the hidden project either");

  const main = await admin.post<{ id: string }>(`/api/dashboards/${d.body.id}/blocks`, { type: "pivot", title: "Secret only", config: { dataSource: { projectId: secret }, dimensionFieldId: "sys_status" } });
  const none = await viewer.post<{ error?: string; pivot?: unknown }>(`/api/dashboard-blocks/${main.body.id}/data`, {});
  assert.match(none.body.error ?? "", /no longer exists/);
  assert.equal(none.body.pivot, undefined);

  // A hidden merge source: its columns stay (no values), but nothing of its field setup leaks (option labels...).
  const secretField = (await admin.post<{ id: string }>(`/api/projects/${secret}/custom-fields`, { name: "Grade", type: "single_select", config: { options: [{ id: "g1", label: "Confidential grade", color: "#f00" }] } })).body.id;
  const merged = await admin.post<{ id: string }>(`/api/dashboards/${d.body.id}/blocks`, { type: "table", title: "Merged", config: { dataSource: { projectId: open, merge: { projectId: secret, leftFieldId: "sys_title", rightFieldId: "sys_title", fieldIds: [secretField] } }, tableFieldIds: ["sys_title", `m:${secretField}`] } });
  const table = await viewer.post<{ columns?: string[]; rows?: string[][]; hiddenSources?: number }>(`/api/dashboard-blocks/${merged.body.id}/data`, {});
  assert.equal(table.body.hiddenSources, 1, JSON.stringify(table.body));
  assert.deepEqual(table.body.rows, [["Open work", ""]]);
  assert.doesNotMatch(JSON.stringify(table.body), /Confidential grade|Hidden from viewer|Grade/, "no option, project or field name of the hidden source");
  const stacked = await admin.post<{ id: string }>(`/api/dashboards/${d.body.id}/blocks`, { type: "stacked_column", title: "Stacked", config: { dataSource: { projectId: open, appendProjectIds: [secret] }, dimensionFieldId: "__project", dimension2FieldId: "sys_status", measureFieldId: "sys_actual", aggregation: "sum" } });
  assert.equal((await viewer.post<{ hiddenSources?: number }>(`/api/dashboard-blocks/${stacked.body.id}/data`, {})).body.hiddenSources, 1, "stacked charts carry the notice too");

  // AI report hours: every source project of the dashboard (appended ones too), only those the reader may see.
  const unassignedActual = async () => {
    const prompt = (await lastModelRequest()).body.systemInstruction!.parts[0].text;
    return prompt.split("\n").find((l) => l.startsWith("(unassigned) | (no category) |"))?.split(" | ")[5];
  };
  const report = { targetKind: "dashboard", targetId: d.body.id, prompt: "Hours", data: "## By project", charts: [] };
  assert.equal((await admin.post("/api/ai/report", report)).status, 200);
  assert.equal(await unassignedActual(), "7", "the author's report counts the appended project");
  assert.equal((await viewer.post("/api/ai/report", report)).status, 200);
  assert.equal(await unassignedActual(), "2", "the viewer's report leaves the hidden project out");
});

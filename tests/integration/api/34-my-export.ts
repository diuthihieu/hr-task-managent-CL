import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { admin, viewer, outsider, s, prisma, BASE, type Rec } from "./context";
import { Client } from "../client";

// "Export my data": tasks a member may see in EVERY workspace they belong to, merged into one file,
// filtered by dates / people / projects / workspaces; hidden projects never reach the file.
test("my export merges my workspaces, keeps permissions, filters and counts hours once", async () => {
  const ws2 = await admin.post<{ id: string }>("/api/workspaces", { name: "MX Second Co" });
  assert.equal(ws2.status, 201, JSON.stringify(ws2.body));
  await prisma.workspaceMember.create({ data: { workspaceId: ws2.body.id, userId: s.viewerId, role: "editor" } });
  const proj = async (ws: string, name: string) => (await admin.post<{ id: string }>(`/api/workspaces/${ws}/projects`, { name })).body.id;
  const [pa, ph, pb] = [await proj(s.ws, "MX Visible"), await proj(s.ws, "MX Hidden"), await proj(ws2.body.id, "MX Other")];
  await prisma.projectHiddenMember.create({ data: { projectId: ph, userId: s.viewerId } });
  const me = (await prisma.user.findFirstOrThrow({ where: { email: "admin@integration.test" } })).id;
  const done2 = (await prisma.status.findFirstOrThrow({ where: { workspaceId: ws2.body.id, category: "done" } })).id;
  const parent = await admin.post<Rec>(`/api/projects/${pa}/tasks`, { data: { sys_title: "MX parent", sys_assignees: [s.viewerId], sys_report_to: [me], sys_actual: 10, sys_start_date: "2026-10-01", sys_due_date: "2026-10-20" } });
  assert.equal(parent.status, 201, JSON.stringify(parent.body));
  assert.equal((await admin.post(`/api/projects/${pa}/tasks`, { data: { sys_title: "MX child", sys_parent: [parent.body.id], sys_assignees: [me], sys_actual: 4, sys_start_date: "2026-10-02", sys_due_date: "2026-10-18" } })).status, 201);
  assert.equal((await admin.post(`/api/projects/${ph}/tasks`, { data: { sys_title: "MX secret", sys_assignees: [s.viewerId], sys_actual: 7 } })).status, 201);
  const other = await admin.post<Rec>(`/api/projects/${pb}/tasks`, { data: { sys_title: "MX other ws", sys_assignees: [s.viewerId], sys_actual: 3, sys_status: done2, sys_completed_at: "2026-10-15T05:00:00.000Z" } });
  assert.equal(other.status, 201, JSON.stringify(other.body));

  type Opts = { me: string; workspaces: { id: string; name: string }[]; projects: { id: string }[]; people: { id: string }[] };
  const opts = await viewer.get<Opts>("/api/account/export");
  assert.equal(opts.status, 200);
  assert.equal(opts.body.me, s.viewerId);
  assert.ok(opts.body.workspaces.some((w) => w.id === s.ws) && opts.body.workspaces.some((w) => w.id === ws2.body.id), "both of my workspaces");
  assert.ok(opts.body.projects.some((p) => p.id === pb) && !opts.body.projects.some((p) => p.id === ph), "a hidden project is not offered");

  type Prev = { count: number; actualHours: number; workspaces: number; tooMany: boolean };
  const preview = async (filters: unknown, client = viewer) => (await client.post<Prev>("/api/account/export", { filters, preview: true })).body;
  const scope = { projectIds: [pa, ph, pb] };
  assert.deepEqual(await preview({ ...scope, assigneeIds: [s.viewerId] }), { count: 2, tooMany: false, max: 20000, actualHours: 9, workspaces: 2 } as unknown as Prev, "parent own 10 - 4 = 6 h + 3 h in the other workspace; the hidden task is left out");
  assert.equal((await preview(scope)).count, 3, "parent, child and the other workspace's task");
  assert.equal((await preview({ ...scope, completedAt: { from: "2026-10-15", to: "2026-10-15" } })).count, 1, "completed on that day (inclusive)");
  assert.equal((await preview({ ...scope, dueDate: { from: "2026-10-19" } })).count, 1, "due from the 19th: the parent only");
  assert.equal((await preview({ ...scope, startDate: { to: "2026-10-01" } })).count, 1);
  assert.equal((await preview({ ...scope, reporterIds: [me] })).count, 1, "reports to the admin: the parent");
  assert.equal((await preview({ ...scope, workspaceIds: [ws2.body.id] })).count, 1, "one workspace only");
  assert.equal((await preview({ projectIds: [ph] })).count, 0, "asking for a hidden project gives nothing");
  assert.equal((await preview({}, outsider)).count, 0, "no workspace, no data");

  const download = async (body: unknown) => {
    const res = await fetch(`${BASE}/api/account/export`, { method: "POST", headers: { "content-type": "application/json", "x-real-ip": "203.0.113.7", cookie: viewer.cookieHeader() }, body: JSON.stringify(body) });
    return { status: res.status, type: res.headers.get("content-type") ?? "", bytes: new Uint8Array(await res.arrayBuffer()) };
  };
  const before = await prisma.activityLog.count({ where: { actorId: s.viewerId, action: "exported" } });
  const x = await download({ filters: scope, columns: ["workspace", "project", "title", "parent", "assignees", "actualH", "ownActualH", "completedAt"], format: "xlsx" });
  assert.equal(x.status, 200);
  assert.match(x.type, /spreadsheetml/);
  const wb = XLSX.read(x.bytes, { type: "array" });
  assert.equal(wb.SheetNames.length, 2, "Tasks + Summary");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Tasks, { header: 1 });
  assert.equal(rows.length, 4, "header + 3 tasks");
  const byTitle = new Map(rows.slice(1).map((r) => [String(r[2]), r]));
  const adminName = (await prisma.user.findUniqueOrThrow({ where: { id: me } })).name;
  // Columns come in the standard order: workspace, project, task, parent, assignees, completed, actual, own actual.
  assert.deepEqual(byTitle.get("MX child")!.slice(3, 8), ["MX parent", adminName, "", 4, 4]);
  assert.deepEqual(byTitle.get("MX parent")!.slice(6, 8), [10, 6], "total vs own hours");
  assert.equal(byTitle.get("MX other ws")![0], "MX Second Co");
  assert.equal(byTitle.get("MX other ws")![5], "2026-10-15");
  const summary = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[1]], { header: 1 });
  const total = summary.find((r) => r[2] === 3 && typeof r[4] === "number");
  assert.equal(total?.[4], 13, "6 + 4 + 3 own hours: the parent's sub-task is not counted twice");
  assert.doesNotMatch(JSON.stringify(rows) + JSON.stringify(summary), /MX secret|MX Hidden/);
  assert.equal(await prisma.activityLog.count({ where: { actorId: s.viewerId, action: "exported" } }), before + 2, "logged in both workspaces");

  const csv = await download({ filters: { ...scope, assigneeIds: [s.viewerId] }, columns: ["title", "ownActualH"], format: "csv" });
  assert.deepEqual([...csv.bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], "UTF-8 BOM for Excel");
  const text = new TextDecoder().decode(csv.bytes);
  assert.equal(text.trim().split("\r\n").length, 3);
  assert.equal((await download({ filters: scope, columns: [], format: "csv" })).status, 400, "at least one column");
  assert.equal((await new Client().get("/api/account/export")).status, 401);
});

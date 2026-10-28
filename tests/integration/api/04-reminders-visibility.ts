import { test } from "node:test";
import assert from "node:assert/strict";
import { ADMIN_EMAIL, prisma, admin, contributor, viewer, s, type Notif, type Rec } from "./context";

test("report-to: recipients are notified when the assignee changes status or details", async () => {
  const statuses = (await admin.get<{ id: string; category: string }[]>(`/api/workspaces/${s.ws}/statuses`)).body;
  const inProgress = statuses.find((x) => x.category === "in_progress")!.id;
  const t = await contributor.post<Rec>(`/api/projects/${s.project}/tasks`, { data: { sys_title: "Payroll reconciliation", sys_assignees: [s.contributorId], sys_report_to: [s.viewerId] } });
  assert.equal(t.status, 201, JSON.stringify(t.body));
  s.reportTask = t.body.id;
  assert.deepEqual(t.body.data.sys_report_to, [s.viewerId]);
  // Only workspace members can receive reports.
  assert.equal((await contributor.patch(`/api/tasks/${s.reportTask}`, { data: { sys_report_to: [s.outsiderId] } })).status, 400);

  let inbox = (await viewer.get<{ unread: number; items: Notif[] }>("/api/notifications")).body;
  assert.ok(inbox.items.some((n) => n.type === "task_report_added" && n.title === "Payroll reconciliation"), "added as report recipient");

  assert.equal((await contributor.patch(`/api/tasks/${s.reportTask}`, { data: { sys_status: inProgress } })).status, 200);
  assert.equal((await contributor.patch(`/api/tasks/${s.reportTask}`, { data: { sys_due_date: "2026-12-01", sys_progress: 40 } })).status, 200);
  inbox = (await viewer.get<{ unread: number; items: Notif[] }>("/api/notifications")).body;
  const status = inbox.items.find((n) => n.type === "task_status");
  assert.ok(status, "status change notified");
  assert.match(status!.link!, new RegExp(`/p/${s.project}/t/${s.reportTask}$`));
  const upd = inbox.items.find((n) => n.type === "task_updated");
  assert.deepEqual((upd!.data!.fields as string[]).sort(), ["dueDate", "progress"]);
  assert.ok(inbox.unread >= 3);
  // The actor never notifies themselves.
  const mine = (await contributor.get<{ items: Notif[] }>("/api/notifications")).body.items;
  assert.ok(!mine.some((n) => n.type === "task_status" && n.title === "Payroll reconciliation"));

  // Comments reach assignees + report recipients.
  await admin.post(`/api/tasks/${s.reportTask}/comments`, { body: "Please double-check the overtime rows" });
  assert.ok((await viewer.get<{ items: Notif[] }>("/api/notifications")).body.items.some((n) => n.type === "task_comment"));

  // Read state is per user and scoped.
  const one = inbox.items[0];
  assert.equal((await contributor.patch(`/api/notifications/${one.id}`, { read: true })).status, 404, "can't touch someone else's notification");
  assert.equal((await viewer.patch(`/api/notifications/${one.id}`, { read: true })).status, 200);
  assert.equal((await viewer.post("/api/notifications/read-all")).status, 200);
  assert.equal((await viewer.get<{ unread: number }>("/api/notifications?unread=1")).body.unread, 0);
});

test("reminders: due-soon / overdue tasks and quick captures past their planned time, created once", async () => {
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const late = await contributor.post<Rec>(`/api/projects/${s.project}/tasks`, { data: { sys_title: "Late task", sys_assignees: [s.contributorId], sys_start_date: yesterday, sys_due_date: yesterday } });
  const soon = await contributor.post<Rec>(`/api/projects/${s.project}/tasks`, { data: { sys_title: "Soon task", sys_assignees: [s.contributorId], sys_due_date: tomorrow } });
  assert.equal(late.status, 201, JSON.stringify(late.body));
  const th = await contributor.post<{ id: string }>(`/api/workspaces/${s.ws}/thoughts`, { taskName: "Call the insurer", projectId: s.project, plannedAt: new Date(Date.now() - 3600000).toISOString() });
  assert.equal(th.status, 201);
  s.thought = th.body.id;

  const first = (await contributor.get<{ items: Notif[] }>("/api/notifications")).body.items;
  assert.ok(first.some((n) => n.type === "task_overdue" && n.title === "Late task"));
  assert.ok(first.some((n) => n.type === "task_due_soon" && n.title === "Soon task"));
  assert.ok(first.some((n) => n.type === "capture_due" && n.title === "Call the insurer"));
  await contributor.get("/api/notifications");
  const count = await prisma.notification.count({ where: { userId: s.contributorId, type: { in: ["task_overdue", "task_due_soon", "capture_due"] } } });
  assert.equal(count, 3, "dedupe keys: polling again creates nothing new");
  await prisma.task.deleteMany({ where: { id: { in: [late.body.id, soon.body.id] } } });
});

test("quick capture converts into the project the user picks", async () => {
  const otherCat = (await admin.get<{ id: string }[]>(`/api/projects/${s.otherProject}/categories`)).body[0].id;
  // A category from a different project is rejected.
  assert.equal((await contributor.post(`/api/thoughts/${s.thought}/convert`, { projectId: s.otherProject, categoryId: s.category })).status, 400);
  const res = await contributor.post<{ taskId: string; projectId: string }>(`/api/thoughts/${s.thought}/convert`, { projectId: s.otherProject, categoryId: otherCat, ownerId: s.viewerId });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.projectId, s.otherProject);
  const task = await prisma.task.findUniqueOrThrow({ where: { id: res.body.taskId } });
  assert.equal(task.projectId, s.otherProject);
  assert.equal(task.categoryId, otherCat);
  assert.ok((await viewer.get<{ items: Notif[] }>("/api/notifications")).body.items.some((n) => n.type === "task_assigned" && n.title === "Call the insurer"));
});

test("project visibility: owners hide a project from chosen members", async () => {
  // Default: every member sees it.
  const before = (await viewer.get<{ id: string }[]>(`/api/workspaces/${s.ws}/projects`)).body.map((p) => p.id);
  assert.ok(before.includes(s.otherProject));
  // Contributors can't change visibility; owners/admins and the project owner can't be hidden.
  assert.equal((await contributor.put(`/api/projects/${s.otherProject}/visibility`, { hiddenUserIds: [s.viewerId] })).status, 403);
  const me = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
  assert.equal((await admin.put(`/api/projects/${s.otherProject}/visibility`, { hiddenUserIds: [me.id] })).status, 400);
  assert.equal((await admin.put(`/api/projects/${s.otherProject}/visibility`, { hiddenUserIds: [s.outsiderId] })).status, 400, "not a member");

  assert.equal((await admin.put(`/api/projects/${s.otherProject}/visibility`, { hiddenUserIds: [s.viewerId] })).status, 200);
  const vis = await admin.get<{ canManage: boolean; members: { id: string; hidden: boolean; lockedReason: string | null }[] }>(`/api/projects/${s.otherProject}/visibility`);
  assert.equal(vis.body.canManage, true);
  assert.equal(vis.body.members.find((m) => m.id === s.viewerId)!.hidden, true);

  const after = (await viewer.get<{ id: string }[]>(`/api/workspaces/${s.ws}/projects`)).body.map((p) => p.id);
  assert.ok(!after.includes(s.otherProject), "hidden from the list");
  assert.ok(after.includes(s.project), "other projects unaffected");
  assert.equal((await viewer.get(`/api/projects/${s.otherProject}`)).status, 404);
  assert.equal((await viewer.get(`/api/projects/${s.otherProject}/tasks`)).status, 404);
  const hiddenTask = await prisma.task.findFirstOrThrow({ where: { projectId: s.otherProject, deletedAt: null } });
  assert.equal((await viewer.get(`/api/tasks/${hiddenTask.id}/comments`)).status, 404);
  const search = await viewer.get<{ projects: { id: string }[]; tasks: { id: string }[] }>(`/api/search?workspaceId=${s.ws}&q=insurer`);
  assert.ok(!JSON.stringify(search.body).includes(hiddenTask.id), "not in search");
  const mywork = await viewer.get<{ tasks: { taskId: string }[] }>(`/api/workspaces/${s.ws}/my-work`);
  assert.ok(!JSON.stringify(mywork.body).includes(hiddenTask.id), "not in My Work even when assigned");
  const notifs = async () => (await viewer.get<{ items: { title: string; projectName: string | null }[] }>("/api/notifications")).body.items;
  assert.ok(!(await notifs()).some((n) => n.title === "Call the insurer"), "older notifications about the hidden project disappear too");
  // OKRs of a hidden project don't leak through the pickers either.
  const hiddenObj = await admin.post<{ id: string; keyResults: { id: string }[] }>(`/api/workspaces/${s.ws}/objectives`, { title: "Secret insurer objective", projectId: s.otherProject });
  const hiddenKr = await admin.post<{ keyResults: { id: string; title: string }[] }>(`/api/objectives/${hiddenObj.body.id}/key-results`, { title: "Secret KR" });
  const opts = await viewer.get<{ objectives: { id: string }[]; keyResults: { id: string }[] }>(`/api/workspaces/${s.ws}/okr-options`);
  assert.ok(!JSON.stringify(opts.body).includes(hiddenObj.body.id) && !opts.body.keyResults.some((k) => hiddenKr.body.keyResults.some((h) => h.id === k.id)), "no hidden objective or key result in the pickers");
  // Everyone else still sees it.
  assert.equal((await contributor.get(`/api/projects/${s.otherProject}`)).status, 200);

  // Promoting the member to admin clears the rule; so does un-hiding.
  assert.equal((await admin.put(`/api/projects/${s.otherProject}/visibility`, { hiddenUserIds: [] })).status, 200);
  assert.equal((await viewer.get(`/api/projects/${s.otherProject}`)).status, 200);
  assert.ok((await notifs()).some((n) => n.title === "Call the insurer"), "and come back when access is restored");
});

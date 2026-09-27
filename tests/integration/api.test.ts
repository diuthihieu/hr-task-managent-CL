// End-to-end API tests against a running server and a real (throwaway)
// PostgreSQL database. Run with `npm run test:integration`, which creates the
// database, applies migrations, bootstraps the admin and starts the server.
// Tests run in order and share state (one scenario, many assertions).

import { test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { Client } from "./client";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@integration.test";
const ADMIN_BOOTSTRAP_PASSWORD = process.env.ADMIN_PASSWORD ?? "Bootstrap123";
const ADMIN_PASSWORD = "AdminPass456";

const prisma = new PrismaClient();
const admin = new Client();
const contributor = new Client();
const viewer = new Client();
const outsider = new Client();

const s: Record<string, string> = {};

type Rec = { id: string; data: Record<string, unknown> };

test.after(async () => {
  await prisma.$disconnect();
});

test("anonymous requests are rejected and public sign-up does not exist", async () => {
  const anon = new Client();
  assert.equal((await anon.get("/api/workspaces")).status, 401);
  assert.equal((await anon.get("/api/admin/users")).status, 401);
  const reg = await anon.post("/api/auth/register", { email: "x@y.z", password: "abcdefgh1", name: "X" });
  assert.notEqual(reg.status, 200);
  assert.notEqual(reg.status, 201);
});

test("bootstrap admin signs in and must replace the temporary password", async () => {
  assert.ok(await admin.login(ADMIN_EMAIL, ADMIN_BOOTSTRAP_PASSWORD), "admin login");
  const weak = await admin.post("/api/account/password", { currentPassword: ADMIN_BOOTSTRAP_PASSWORD, newPassword: "short" });
  assert.equal(weak.status, 400);
  const ok = await admin.post("/api/account/password", { currentPassword: ADMIN_BOOTSTRAP_PASSWORD, newPassword: ADMIN_PASSWORD });
  assert.equal(ok.status, 200);
  const row = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
  assert.equal(row.mustChangePassword, false);
  assert.notEqual(row.passwordHash, ADMIN_PASSWORD, "password is hashed");
});

test("the database starts empty: no workspaces, projects or tasks are pre-loaded", async () => {
  assert.equal(await prisma.workspace.count(), 0);
  assert.equal(await prisma.project.count(), 0);
  assert.equal(await prisma.task.count(), 0);
});

test("admin creates a workspace with default statuses and no categories", async () => {
  const res = await admin.post<{ id: string; slug: string }>("/api/workspaces", { name: "HR Operations" });
  assert.equal(res.status, 201);
  s.ws = res.body.id;
  const statuses = await admin.get<{ id: string; name: string; category: string; isDefault: boolean }[]>(`/api/workspaces/${s.ws}/statuses`);
  assert.equal(statuses.status, 200);
  assert.ok(statuses.body.some((x) => x.category === "done"));
  assert.equal(statuses.body.filter((x) => x.isDefault).length, 1);
  s.statusDone = statuses.body.find((x) => x.category === "done")!.id;
  s.statusTodo = statuses.body.find((x) => x.isDefault)!.id;
  const cats = await admin.get<unknown[]>(`/api/workspaces/${s.ws}/categories`);
  assert.deepEqual(cats.body, []);
});

test("only admins create accounts; created users get a one-time temporary password", async () => {
  const c = await admin.post<{ id: string; temporaryPassword: string }>("/api/admin/users", {
    email: "Contributor@Integration.test",
    name: "Casey Contributor",
    workspaceId: s.ws,
    workspaceRole: "contributor",
  });
  assert.equal(c.status, 201);
  assert.ok(c.body.temporaryPassword.length >= 8);
  s.contributorId = c.body.id;
  s.contributorPw = c.body.temporaryPassword;
  // Email is normalized to lowercase; duplicates are rejected.
  const dup = await admin.post("/api/admin/users", { email: "contributor@integration.test", name: "Dup" });
  assert.equal(dup.status, 400);

  const v = await admin.post<{ id: string; temporaryPassword: string }>("/api/admin/users", { email: "viewer@integration.test", name: "Vic Viewer", workspaceId: s.ws, workspaceRole: "viewer" });
  s.viewerId = v.body.id;
  s.viewerPw = v.body.temporaryPassword;
  const o = await admin.post<{ id: string; temporaryPassword: string }>("/api/admin/users", { email: "outsider@integration.test", name: "Olly Outsider" });
  s.outsiderId = o.body.id;
  s.outsiderPw = o.body.temporaryPassword;

  assert.ok(await contributor.login("contributor@integration.test", s.contributorPw));
  assert.ok(await viewer.login("viewer@integration.test", s.viewerPw));
  assert.ok(await outsider.login("outsider@integration.test", s.outsiderPw));

  // Non-admins cannot manage accounts or create workspaces.
  assert.equal((await contributor.get("/api/admin/users")).status, 403);
  assert.equal((await contributor.post("/api/admin/users", { email: "z@z.zz", name: "Z" })).status, 403);
  assert.equal((await contributor.post("/api/workspaces", { name: "Mine" })).status, 403);
});

test("workspace roles are enforced by the API", async () => {
  assert.equal((await contributor.post(`/api/workspaces/${s.ws}/projects`, { name: "Nope" })).status, 403);
  const p = await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/projects`, { name: "Onboarding Q4" });
  assert.equal(p.status, 201);
  s.project = p.body.id;
  const cat = await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/categories`, { name: "Onboarding", color: "#22c55e" });
  assert.equal(cat.status, 201);
  s.category = cat.body.id;
  assert.equal((await contributor.post(`/api/workspaces/${s.ws}/categories`, { name: "X" })).status, 403);
  // Outsider can't even see the workspace exists.
  assert.equal((await outsider.get(`/api/projects/${s.project}`)).status, 404);
  assert.equal((await outsider.get(`/api/projects/${s.project}/tasks`)).status, 404);
});

test("contributor creates a task; values land in typed columns and join tables", async () => {
  const res = await contributor.post<Rec>(`/api/projects/${s.project}/tasks`, {
    data: {
      sys_title: "Prepare laptop for new hire",
      sys_category: s.category,
      sys_assignees: [s.contributorId],
      sys_start_date: "2026-10-01",
      sys_due_date: "2026-10-05",
      sys_priority: "high",
      sys_estimate: 1.5,
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  s.task1 = res.body.id;
  const row = await prisma.task.findUniqueOrThrow({ where: { id: s.task1 }, include: { assignees: true } });
  assert.equal(row.title, "Prepare laptop for new hire");
  assert.equal(row.categoryId, s.category);
  assert.equal(row.statusId, s.statusTodo, "default status applied");
  assert.equal(row.estimateMinutes, 90);
  assert.equal(row.priority, "high");
  assert.equal(row.dueDate?.toISOString().slice(0, 10), "2026-10-05");
  assert.deepEqual(row.assignees.map((a) => a.userId), [s.contributorId]);
  assert.equal(row.createdById, s.contributorId);
  assert.match(row.id, /^[0-9a-f-]{36}$/, "uuid primary key");
});

test("validation and database constraints reject bad data", async () => {
  const badRange = await contributor.patch<{ error: string }>(`/api/tasks/${s.task1}`, { data: { sys_due_date: "2026-09-01" } });
  assert.equal(badRange.status, 400, "due date before start date (CHECK constraint)");
  assert.equal(badRange.body.error, "Due date must be on or after the start date", "raw database errors are not leaked");
  assert.equal((await contributor.patch(`/api/tasks/${s.task1}`, { data: { sys_progress: 150 } })).status, 400);
  assert.equal((await contributor.patch(`/api/tasks/${s.task1}`, { data: { sys_title: "   " } })).status, 400);
  assert.equal((await contributor.patch(`/api/tasks/${s.task1}`, { data: { sys_assignees: [s.outsiderId] } })).status, 400, "assignee must be a member");
  assert.equal((await contributor.patch(`/api/tasks/${s.task1}`, { data: { not_a_field: 1 } })).status, 400);
  assert.equal((await contributor.patch(`/api/tasks/${s.task1}`, { data: { sys_created_at: "2020-01-01" } })).status, 400, "read-only field");
  // Nothing partially applied.
  const row = await prisma.task.findUniqueOrThrow({ where: { id: s.task1 } });
  assert.equal(row.dueDate?.toISOString().slice(0, 10), "2026-10-05");
});

test("status change to a done-category status completes the task", async () => {
  const res = await contributor.patch<Rec>(`/api/tasks/${s.task1}`, { data: { sys_status: s.statusDone } });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.sys_progress, 100);
  const row = await prisma.task.findUniqueOrThrow({ where: { id: s.task1 } });
  assert.ok(row.completedAt);
});

test("dependencies: self-reference and cycles are rejected", async () => {
  const t2 = await admin.post<Rec>(`/api/projects/${s.project}/tasks`, { data: { sys_title: "Create email account" } });
  s.task2 = t2.body.id;
  const t3 = await admin.post<Rec>(`/api/projects/${s.project}/tasks`, { data: { sys_title: "Day-one briefing" } });
  s.task3 = t3.body.id;
  assert.equal((await admin.patch(`/api/tasks/${s.task2}`, { data: { sys_depends_on: [s.task2] } })).status, 400);
  assert.equal((await admin.patch(`/api/tasks/${s.task2}`, { data: { sys_depends_on: [s.task1] } })).status, 200);
  assert.equal((await admin.patch(`/api/tasks/${s.task3}`, { data: { sys_depends_on: [s.task2] } })).status, 200);
  const cycle = await admin.patch<{ error: string }>(`/api/tasks/${s.task1}`, { data: { sys_depends_on: [s.task3] } });
  assert.equal(cycle.status, 400);
  assert.match(cycle.body.error, /cycle/i);
  assert.equal(await prisma.taskDependency.count(), 2);
  // Subtasks (self-referencing parent) with cycle protection.
  assert.equal((await admin.patch(`/api/tasks/${s.task3}`, { data: { sys_parent: [s.task2] } })).status, 200);
  assert.equal((await admin.patch(`/api/tasks/${s.task2}`, { data: { sys_parent: [s.task3] } })).status, 400);
});

test("contributors edit only their own/assigned tasks; viewers are read-only but can comment", async () => {
  assert.equal((await contributor.patch(`/api/tasks/${s.task2}`, { data: { sys_title: "Hijack" } })).status, 403);
  assert.equal((await viewer.patch(`/api/tasks/${s.task1}`, { data: { sys_title: "Hijack" } })).status, 403);
  assert.equal((await viewer.post(`/api/projects/${s.project}/tasks`, { data: { sys_title: "Nope" } })).status, 403);
  const tasks = await viewer.get<Rec[]>(`/api/projects/${s.project}/tasks`);
  assert.equal(tasks.status, 200);
  assert.equal(tasks.body.length, 3);
  const c = await viewer.post<{ id: string }>(`/api/tasks/${s.task1}/comments`, { body: "Laptop arrived?" });
  assert.equal(c.status, 201);
  s.comment = c.body.id;
  assert.equal((await contributor.patch(`/api/comments/${s.comment}`, { body: "edited by someone else" })).status, 403);
  assert.equal((await viewer.patch(`/api/comments/${s.comment}`, { body: "Has the laptop arrived?" })).status, 200);
});

test("custom fields: typed values, option validation, option removal", async () => {
  assert.equal((await contributor.post(`/api/projects/${s.project}/custom-fields`, { name: "X", type: "text" })).status, 403);
  const f = await admin.post<{ id: string }>(`/api/projects/${s.project}/custom-fields`, {
    name: "Location",
    type: "single_select",
    config: { options: [{ label: "Hanoi", color: "#3b82f6" }, { label: "HCMC", color: "#22c55e" }] },
  });
  assert.equal(f.status, 201);
  s.fieldLocation = f.body.id;
  const detail = await admin.get<{ fields: { id: string; config: string }[] }>(`/api/projects/${s.project}`);
  const options = JSON.parse(detail.body.fields.find((x) => x.id === s.fieldLocation)!.config).options as { id: string; label: string }[];
  const hanoi = options.find((o) => o.label === "Hanoi")!;
  assert.equal((await admin.patch(`/api/tasks/${s.task2}`, { data: { [s.fieldLocation]: hanoi.id } })).status, 200);
  const stored = await prisma.taskCustomFieldValue.findUniqueOrThrow({ where: { taskId_customFieldId: { taskId: s.task2, customFieldId: s.fieldLocation } } });
  assert.equal(stored.valueOptionId, hanoi.id, "stored as a FK to custom_field_options");
  assert.equal((await admin.patch(`/api/tasks/${s.task2}`, { data: { [s.fieldLocation]: "00000000-0000-0000-0000-000000000000" } })).status, 400);

  const n = await admin.post<{ id: string }>(`/api/projects/${s.project}/custom-fields`, { name: "Cost", type: "currency" });
  assert.equal((await admin.patch(`/api/tasks/${s.task2}`, { data: { [n.body.id]: "abc" } })).status, 400);
  assert.equal((await admin.patch(`/api/tasks/${s.task2}`, { data: { [n.body.id]: 1250.5 } })).status, 200);

  // Removing an option clears values that pointed at it (ON DELETE SET NULL).
  const keep = options.filter((o) => o.id !== hanoi.id);
  assert.equal((await admin.patch(`/api/custom-fields/${s.fieldLocation}`, { config: { options: keep } })).status, 200);
  const after = await prisma.taskCustomFieldValue.findUniqueOrThrow({ where: { taskId_customFieldId: { taskId: s.task2, customFieldId: s.fieldLocation } } });
  assert.equal(after.valueOptionId, null);
  // Type can't be changed after creation.
  assert.equal((await admin.patch(`/api/custom-fields/${s.fieldLocation}`, { type: "text" })).status, 400);
});

test("soft delete hides a task, keeps the row, and editors can restore it", async () => {
  assert.equal((await admin.del(`/api/tasks/${s.task3}`)).status, 204);
  const list = await admin.get<Rec[]>(`/api/projects/${s.project}/tasks`);
  assert.ok(!list.body.some((t) => t.id === s.task3));
  const row = await prisma.task.findUniqueOrThrow({ where: { id: s.task3 } });
  assert.ok(row.deletedAt);
  assert.equal(row.deletedById, (await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } })).id);
  assert.equal((await admin.get(`/api/tasks/${s.task3}`)).status, 404);
  assert.equal((await contributor.post(`/api/tasks/${s.task3}/restore`)).status, 403);
  assert.equal((await admin.post(`/api/tasks/${s.task3}/restore`)).status, 200);
});

test("important changes are written to the activity log in the same transaction", async () => {
  const logs = await prisma.activityLog.findMany({ where: { entityType: "task", entityId: s.task1 }, orderBy: { createdAt: "asc" } });
  assert.ok(logs.some((l) => l.action === "created"));
  const statusLog = logs.find((l) => l.action === "status_changed");
  assert.ok(statusLog, "status change logged");
  assert.deepEqual((statusLog!.changes as Record<string, { to: string }>).status.to, s.statusDone);
  // Failed (400) updates left no log rows behind.
  assert.ok(!logs.some((l) => JSON.stringify(l.changes ?? {}).includes("2026-09-01")));
  // Append-only: the database refuses updates.
  await assert.rejects(prisma.activityLog.update({ where: { id: logs[0].id }, data: { summary: "tampered" } }));
  const api = await admin.get<unknown[]>(`/api/workspaces/${s.ws}/activity`);
  assert.equal(api.status, 200);
  assert.ok(api.body.length > 5);
  assert.equal((await contributor.get(`/api/workspaces/${s.ws}/activity`)).status, 403);
});

test("statuses in use can't be deleted without reassigning their tasks", async () => {
  const del = await admin.del(`/api/statuses/${s.statusDone}`);
  assert.equal(del.status, 400);
  const inProgress = (await admin.get<{ id: string; category: string }[]>(`/api/workspaces/${s.ws}/statuses`)).body.find((x) => x.category === "in_progress")!;
  assert.equal((await admin.del(`/api/statuses/${s.statusDone}?reassignTo=${inProgress.id}`)).status, 204);
  const row = await prisma.task.findUniqueOrThrow({ where: { id: s.task1 } });
  assert.equal(row.statusId, inProgress.id);
});

test("goals: task-based key result progress is derived from linked tasks", async () => {
  const o = await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/objectives`, { title: "Great onboarding", ownerId: s.contributorId });
  assert.equal(o.status, 201);
  const withKr = await admin.post<{ keyResults: { id: string }[] }>(`/api/objectives/${o.body.id}/key-results`, { title: "All day-one tasks done" });
  const kr = withKr.body.keyResults[0].id;
  assert.equal((await admin.post(`/api/key-results/${kr}/tasks`, { taskId: s.task1 })).status, 201);
  assert.equal((await admin.post(`/api/key-results/${kr}/tasks`, { taskId: s.task2 })).status, 201);
  await admin.patch(`/api/tasks/${s.task1}`, { data: { sys_progress: 100 } });
  const obj = await admin.get<{ progress: number; keyResults: { progress: number; tasks: unknown[] }[] }>(`/api/objectives/${o.body.id}`);
  assert.equal(obj.body.keyResults[0].tasks.length, 2);
  assert.equal(obj.body.keyResults[0].progress, 50);
  assert.equal(obj.body.progress, 50);
  // Contributor is the owner, so it shows in their My Work.
  const mine = await contributor.get<{ objectives: { id: string }[]; tasks: { taskId: string }[] }>(`/api/workspaces/${s.ws}/my-work`);
  assert.ok(mine.body.objectives.some((x) => x.id === o.body.id));
  assert.ok(mine.body.tasks.some((t) => t.taskId === s.task1));
});

test("attachments require object storage; nothing is written when it's not configured", async () => {
  if (process.env.BLOB_READ_WRITE_TOKEN) return;
  const form = new FormData();
  form.append("file", new Blob(["hello"], { type: "text/plain" }), "note.txt");
  const res = await fetch(`${process.env.TEST_BASE_URL ?? "http://localhost:3100"}/api/tasks/${s.task1}/attachments`, {
    method: "POST",
    body: form,
    headers: { cookie: admin.cookieHeader() },
  });
  assert.equal(res.status, 503);
  assert.equal(await prisma.attachment.count(), 0);
});

test("database triggers block cross-workspace references even if the API had a bug", async () => {
  const other = await admin.post<{ id: string }>("/api/workspaces", { name: "Other Co" });
  const otherStatus = (await admin.get<{ id: string }[]>(`/api/workspaces/${other.body.id}/statuses`)).body[0].id;
  await assert.rejects(prisma.task.update({ where: { id: s.task1 }, data: { statusId: otherStatus } }), /status must belong/);
  await assert.rejects(prisma.taskAssignee.create({ data: { taskId: s.task1, userId: s.outsiderId } }), /assignee must be a member/);
});

test("deactivating an account revokes access immediately, even with a live session", async () => {
  assert.equal((await contributor.get(`/api/projects/${s.project}`)).status, 200);
  assert.equal((await admin.patch(`/api/admin/users/${s.contributorId}`, { isActive: false })).status, 200);
  assert.equal((await contributor.get(`/api/projects/${s.project}`)).status, 401);
  assert.equal(await new Client().login("contributor@integration.test", s.contributorPw), false);
  // The last admin can't lock themselves out.
  const me = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
  assert.equal((await admin.patch(`/api/admin/users/${me.id}`, { isActive: false })).status, 400);
});

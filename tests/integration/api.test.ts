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

test("anonymous requests are rejected; anyone can sign up with a valid email and password", async () => {
  const anon = new Client();
  assert.equal((await anon.get("/api/workspaces")).status, 401);
  assert.equal((await anon.get("/api/admin/users")).status, 401);
  assert.equal((await anon.post("/api/register", { email: "weak@integration.test", password: "short", name: "Weak" })).status, 400, "password policy");
  assert.equal((await anon.post("/api/register", { email: "not-an-email", password: "abcdefgh1", name: "X" })).status, 400);
  assert.equal((await anon.post("/api/register", { email: "bot@integration.test", password: "abcdefgh1", name: "Bot", website: "http://spam" })).status, 400, "honeypot");
  const reg = await anon.post<{ id: string; email: string }>("/api/register", { email: "Contributor@Integration.test", password: "Contrib123", name: "Casey Contributor", locale: "en" });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  assert.equal(reg.body.email, "contributor@integration.test", "email normalized to lowercase");
  s.contributorId = reg.body.id;
  const dup = await anon.post("/api/register", { email: "contributor@integration.test", password: "Contrib123", name: "Dup" });
  assert.equal(dup.status, 409);
  const row = await prisma.user.findUniqueOrThrow({ where: { id: s.contributorId } });
  assert.equal(row.systemRole, "MEMBER");
  assert.equal(row.mustChangePassword, false, "self-chosen password needs no reset");
  assert.equal(row.locale, "en");
  assert.notEqual(row.passwordHash, "Contrib123");
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
  // Categories are per project now; the old workspace-level endpoint is gone.
  assert.equal((await admin.get(`/api/workspaces/${s.ws}/categories`)).status, 404);
  const owner = await prisma.workspaceMember.findFirstOrThrow({ where: { workspaceId: s.ws } });
  assert.equal(owner.role, "owner", "creator becomes the owner");
});

test("owners add signed-up users by email; any user can create their own workspaces", async () => {
  const v = await new Client().post<{ id: string }>("/api/register", { email: "viewer@integration.test", password: "Viewer1234", name: "Vic Viewer" });
  assert.equal(v.status, 201);
  s.viewerId = v.body.id;
  // The admin console can still create an account (with a one-time password).
  const o = await admin.post<{ id: string; temporaryPassword: string }>("/api/admin/users", { email: "outsider@integration.test", name: "Olly Outsider" });
  assert.equal(o.status, 201);
  s.outsiderId = o.body.id;
  s.outsiderPw = o.body.temporaryPassword;

  assert.ok(await contributor.login("contributor@integration.test", "Contrib123"));
  assert.ok(await viewer.login("viewer@integration.test", "Viewer1234"));
  assert.ok(await outsider.login("outsider@integration.test", s.outsiderPw));

  // Only people who signed up can be added.
  const missing = await admin.post<{ error: string }>(`/api/workspaces/${s.ws}/members`, { email: "nobody@integration.test", role: "editor" });
  assert.equal(missing.status, 400);
  assert.match(missing.body.error, /sign up/i);
  assert.equal((await admin.post(`/api/workspaces/${s.ws}/members`, { email: "contributor@integration.test", role: "contributor" })).status, 201);
  assert.equal((await admin.post(`/api/workspaces/${s.ws}/members`, { email: "VIEWER@integration.test", role: "viewer" })).status, 201);
  assert.equal((await admin.post(`/api/workspaces/${s.ws}/members`, { email: "viewer@integration.test", role: "viewer" })).status, 400, "already a member");
  // Members can't add people; non-admins can't manage accounts.
  assert.equal((await contributor.post(`/api/workspaces/${s.ws}/members`, { email: "outsider@integration.test" })).status, 403);
  assert.equal((await contributor.get("/api/admin/users")).status, 403);
  assert.equal((await contributor.post("/api/admin/users", { email: "z@z.zz", name: "Z" })).status, 403);

  // Anyone can create workspaces; they own them and see only their own.
  const mine = await contributor.post<{ id: string }>("/api/workspaces", { name: "Casey's side project" });
  assert.equal(mine.status, 201);
  s.contributorWs = mine.body.id;
  const list = await contributor.get<{ id: string; role: string }[]>("/api/workspaces");
  assert.deepEqual(list.body.map((w) => w.role).sort(), ["contributor", "owner"]);
  assert.equal((await admin.get(`/api/workspaces/${s.contributorWs}`)).status, 200, "system admin can still open any workspace for support");
  assert.equal((await viewer.get(`/api/workspaces/${s.contributorWs}`)).status, 404, "others can't see it");
});

test("workspace roles are enforced by the API; categories belong to a project", async () => {
  assert.equal((await contributor.post(`/api/workspaces/${s.ws}/projects`, { name: "Nope" })).status, 403);
  const p = await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/projects`, { name: "Onboarding Q4", categories: [{ name: "Onboarding" }, { name: "IT setup" }, { name: "onboarding" }] });
  assert.equal(p.status, 201);
  s.project = p.body.id;
  const cats = await admin.get<{ id: string; name: string }[]>(`/api/projects/${s.project}/categories`);
  assert.deepEqual(cats.body.map((c) => c.name), ["Onboarding", "IT setup"], "created with the project, duplicates dropped");
  s.category = cats.body[0].id;
  const extra = await admin.post<{ id: string }>(`/api/projects/${s.project}/categories`, { name: "Payroll", color: "#22c55e" });
  assert.equal(extra.status, 201);
  assert.equal((await contributor.post(`/api/projects/${s.project}/categories`, { name: "X" })).status, 403);
  // A category from another project can't be used on this project's tasks.
  const other = await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/projects`, { name: "Other project", categories: [{ name: "Elsewhere" }] });
  s.otherProject = other.body.id;
  s.otherCategory = (await admin.get<{ id: string }[]>(`/api/projects/${s.otherProject}/categories`)).body[0].id;
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
  assert.equal((await contributor.patch(`/api/tasks/${s.task1}`, { data: { sys_category: s.otherCategory } })).status, 400, "category of another project");
  await assert.rejects(prisma.task.update({ where: { id: s.task1 }, data: { categoryId: s.otherCategory } }), /category must belong to the task project/, "trigger backs it up");
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

test("project objectives: tasks link to an objective or a key result and roll up progress", async () => {
  // No objectives yet -> no Objective field on the task table.
  let detail = await admin.get<{ fields: { id: string; type: string; config: string }[] }>(`/api/projects/${s.project}`);
  assert.ok(!detail.body.fields.some((f) => f.id === "sys_objective"));

  const o = await admin.post<{ id: string; projectId: string; keyResults: { id: string; title: string }[] }>(`/api/workspaces/${s.ws}/objectives`, {
    title: "Smooth first week",
    projectId: s.project,
    ownerId: s.viewerId,
    keyResults: [{ title: "Laptop ready on day one" }, { title: "Buddy assigned", ownerId: s.contributorId }],
  });
  assert.equal(o.status, 201, JSON.stringify(o.body));
  assert.equal(o.body.projectId, s.project);
  assert.equal(o.body.keyResults.length, 2, "key results created with the objective");
  s.projObjective = o.body.id;
  s.krLaptop = o.body.keyResults[0].id;
  s.krBuddy = o.body.keyResults[1].id;
  assert.equal((await contributor.post(`/api/workspaces/${s.ws}/objectives`, { title: "Nope", projectId: s.project })).status, 403);

  detail = await admin.get(`/api/projects/${s.project}`);
  const field = detail.body.fields.find((f) => f.id === "sys_objective");
  assert.ok(field, "Objective field appears once the project has objectives");
  assert.equal(field!.type, "okr_target");
  const cfg = JSON.parse(field!.config) as { objectives: { id: string; keyResults: { id: string }[] }[] };
  assert.equal(cfg.objectives[0].keyResults.length, 2);

  // Pick a key result: the task lands on that branch (and its objective).
  const t1 = await admin.patch<Rec>(`/api/tasks/${s.task1}`, { data: { sys_objective: `kr:${s.krLaptop}` } });
  assert.equal(t1.status, 200, JSON.stringify(t1.body));
  assert.equal(t1.body.data.sys_objective, `kr:${s.krLaptop}`);
  let row = await prisma.task.findUniqueOrThrow({ where: { id: s.task1 } });
  assert.equal(row.keyResultId, s.krLaptop);
  assert.equal(row.objectiveId, s.projObjective);
  // Pick the objective directly.
  assert.equal((await admin.patch(`/api/tasks/${s.task2}`, { data: { sys_objective: `obj:${s.projObjective}` } })).status, 200);
  row = await prisma.task.findUniqueOrThrow({ where: { id: s.task2 } });
  assert.equal(row.keyResultId, null);
  assert.equal(row.objectiveId, s.projObjective);
  assert.equal((await admin.patch(`/api/tasks/${s.task2}`, { data: { sys_objective: "kr:00000000-0000-0000-0000-000000000000" } })).status, 400);
  // The database refuses a key result that doesn't belong to the task's objective.
  const otherObj = await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/objectives`, { title: "Unrelated" });
  await assert.rejects(prisma.task.update({ where: { id: s.task1 }, data: { objectiveId: otherObj.body.id } }), /key result must belong to the task objective/);

  const obj = await admin.get<{ progress: number; tasks: { taskId: string }[]; keyResults: { id: string; tasks: { taskId: string }[] }[] }>(`/api/objectives/${s.projObjective}`);
  assert.deepEqual(obj.body.keyResults.find((k) => k.id === s.krLaptop)!.tasks.map((x) => x.taskId), [s.task1]);
  assert.deepEqual(obj.body.tasks.map((x) => x.taskId), [s.task2], "objective-level tasks listed separately");

  // Team OKRs list every objective (project + workspace level), filterable by project.
  const team = await viewer.get<{ id: string; project: { id: string } | null }[]>(`/api/workspaces/${s.ws}/objectives`);
  assert.ok(team.body.some((x) => x.id === s.projObjective && x.project?.id === s.project));
  const onlyProject = await viewer.get<{ id: string }[]>(`/api/workspaces/${s.ws}/objectives?projectId=${s.project}`);
  assert.deepEqual(onlyProject.body.map((x) => x.id), [s.projObjective]);
  // My OKRs: the viewer owns it, the contributor owns a key result.
  const viewerMine = await viewer.get<{ id: string }[]>(`/api/workspaces/${s.ws}/objectives?mine=1`);
  assert.ok(viewerMine.body.some((x) => x.id === s.projObjective));
  const contribMine = await contributor.get<{ id: string }[]>(`/api/workspaces/${s.ws}/objectives?mine=1`);
  assert.ok(contribMine.body.some((x) => x.id === s.projObjective));
});

test("cascading OKRs: a key result can become another person's objective", async () => {
  const child = await admin.post<{ id: string; parentKeyResult: { id: string; objectiveId: string } | null; parentObjectiveId: string | null }>(`/api/workspaces/${s.ws}/objectives`, {
    title: "Find a buddy for every new hire",
    ownerId: s.contributorId,
    parentKeyResultId: s.krBuddy,
  });
  assert.equal(child.status, 201, JSON.stringify(child.body));
  assert.equal(child.body.parentKeyResult?.id, s.krBuddy);
  assert.equal(child.body.parentObjectiveId, s.projObjective, "parent objective derived from the key result");
  s.childObjective = child.body.id;
  const parent = await admin.get<{ childObjectives: { id: string; parentKeyResultId: string }[] }>(`/api/objectives/${s.projObjective}`);
  assert.deepEqual(parent.body.childObjectives.map((c) => [c.id, c.parentKeyResultId]), [[s.childObjective, s.krBuddy]]);
  // No loops: the parent can't align to its own child's key result, nor to itself.
  const childKr = await admin.post<{ keyResults: { id: string }[] }>(`/api/objectives/${s.childObjective}/key-results`, { title: "10 buddies trained" });
  const loop = await admin.patch<{ error: string }>(`/api/objectives/${s.projObjective}`, { parentKeyResultId: childKr.body.keyResults[0].id });
  assert.equal(loop.status, 400);
  assert.equal((await admin.patch(`/api/objectives/${s.projObjective}`, { parentKeyResultId: s.krBuddy })).status, 400);
  // Deleting the parent key result keeps the child objective but drops the alignment.
  assert.equal((await admin.del(`/api/key-results/${s.krBuddy}`)).status, 200);
  const after = await prisma.objective.findUniqueOrThrow({ where: { id: s.childObjective } });
  assert.equal(after.parentKeyResultId, null);
  assert.equal(after.deletedAt, null);
});

test("record pages and wiki pages store sanitized rich content", async () => {
  const evil = '<p onclick="steal()">Hello <strong>team</strong><script>alert(1)</script><img src="https://evil.example/x.png"><a href="javascript:alert(1)">x</a></p><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked></label><div><p>Done</p></div></li></ul>';
  const put = await contributor.put<{ content: string }>(`/api/tasks/${s.task1}/content`, { content: evil });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.ok(put.body.content.includes("<strong>team</strong>"));
  for (const bad of ["onclick", "<script", "evil.example", "javascript:"]) assert.ok(!put.body.content.includes(bad), `stripped ${bad}`);
  assert.ok(put.body.content.includes('data-checked="true"'), "checklists survive");
  assert.equal((await viewer.put(`/api/tasks/${s.task1}/content`, { content: "<p>x</p>" })).status, 403);
  assert.equal((await contributor.put(`/api/tasks/${s.task2}/content`, { content: "<p>x</p>" })).status, 403, "contributors: own/assigned tasks only");
  const got = await viewer.get<{ content: string }>(`/api/tasks/${s.task1}/content`);
  assert.equal(got.body.content, put.body.content);
  // Grid rows don't carry the page body.
  const rows = await viewer.get<Rec[]>(`/api/projects/${s.project}/tasks`);
  assert.ok(!JSON.stringify(rows.body).includes("<strong>team</strong>"));

  const page = await contributor.post<{ id: string }>(`/api/projects/${s.project}/wiki`, { title: "Onboarding checklist" });
  assert.equal(page.status, 201);
  const sub = await contributor.post<{ id: string }>(`/api/projects/${s.project}/wiki`, { title: "IT", parentPageId: page.body.id });
  assert.equal(sub.status, 201);
  assert.equal((await viewer.post(`/api/projects/${s.project}/wiki`, { title: "Nope" })).status, 403);
  const saved = await contributor.patch<{ content: string }>(`/api/wiki/${page.body.id}`, { content: '<h2>Day one</h2><iframe src="https://x"></iframe>' });
  assert.equal(saved.body.content, "<h2>Day one</h2>");
  assert.equal((await contributor.patch(`/api/wiki/${page.body.id}`, { parentPageId: sub.body.id })).status, 400, "no cycles in the page tree");
  assert.equal((await outsider.get(`/api/wiki/${page.body.id}`)).status, 404);
  const tree = await viewer.get<{ id: string; parentPageId: string | null }[]>(`/api/projects/${s.project}/wiki`);
  assert.equal(tree.body.length, 2);
  // Deleting a page soft-deletes its sub-pages too.
  assert.equal((await admin.del(`/api/wiki/${page.body.id}`)).status, 204);
  assert.equal((await viewer.get<unknown[]>(`/api/projects/${s.project}/wiki`)).body.length, 0);
  assert.equal(await prisma.wikiPage.count({ where: { projectId: s.project, deletedAt: { not: null } } }), 2);
});

test("report views and personal preferences", async () => {
  const v = await admin.post<{ id: string; type: string }>(`/api/projects/${s.project}/views`, {
    name: "Hours report",
    type: "report",
    config: { report: { widgets: [{ id: "w1", title: "Hours by assignee", type: "bar", dimensionFieldId: "sys_assignees", measureFieldId: "sys_estimate", aggregation: "sum" }] } },
  });
  assert.equal(v.status, 201, JSON.stringify(v.body));
  assert.equal(v.body.type, "report");

  const prefs = await contributor.patch<{ locale: string; accentColor: string }>("/api/account/preferences", { locale: "vi", accentColor: "rose" });
  assert.equal(prefs.status, 200);
  assert.deepEqual([prefs.body.locale, prefs.body.accentColor], ["vi", "rose"]);
  assert.equal((await contributor.patch("/api/account/preferences", { accentColor: "not-a-color" })).status, 400);
  assert.equal((await contributor.patch("/api/account/preferences", { locale: "fr" })).status, 400);
});

test("members can leave; only owners delete a workspace", async () => {
  const joined = await admin.post(`/api/workspaces/${s.contributorWs}/members`, { email: "viewer@integration.test", role: "admin" });
  assert.equal(joined.status, 201);
  assert.equal((await viewer.del(`/api/workspaces/${s.contributorWs}`)).status, 403, "workspace admins can't delete it");
  assert.equal((await viewer.del(`/api/workspaces/${s.contributorWs}/members/${s.viewerId}`)).status, 204, "leave");
  assert.equal((await viewer.get(`/api/workspaces/${s.contributorWs}`)).status, 404);
  // The last owner can't leave.
  assert.equal((await contributor.del(`/api/workspaces/${s.contributorWs}/members/${s.contributorId}`)).status, 400);
  assert.equal((await contributor.del(`/api/workspaces/${s.contributorWs}`)).status, 204);
  assert.ok((await prisma.workspace.findUniqueOrThrow({ where: { id: s.contributorWs } })).deletedAt);
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
  assert.equal(await new Client().login("contributor@integration.test", "Contrib123"), false);
  // The last admin can't lock themselves out.
  const me = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
  assert.equal((await admin.patch(`/api/admin/users/${me.id}`, { isActive: false })).status, 400);
});

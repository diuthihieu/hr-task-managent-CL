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

  const wiki = await admin.post<{ id: string; myRole: string }>(`/api/workspaces/${s.ws}/wikis`, { name: "HR handbook" });
  assert.equal(wiki.status, 201);
  assert.equal(wiki.body.myRole, "manager");
  s.wiki = wiki.body.id;
  const page = await contributor.post<{ id: string }>(`/api/wikis/${s.wiki}/pages`, { title: "Onboarding checklist" });
  assert.equal(page.status, 201);
  const sub = await contributor.post<{ id: string }>(`/api/wikis/${s.wiki}/pages`, { title: "IT", parentPageId: page.body.id });
  assert.equal(sub.status, 201);
  assert.equal((await viewer.post(`/api/wikis/${s.wiki}/pages`, { title: "Nope" })).status, 403, "workspace viewers only read");
  const saved = await contributor.patch<{ content: string }>(`/api/wiki/${page.body.id}`, { content: '<h2>Day one</h2><iframe src="https://x"></iframe>' });
  assert.equal(saved.body.content, "<h2>Day one</h2>");
  assert.equal((await contributor.patch(`/api/wiki/${page.body.id}`, { parentPageId: sub.body.id })).status, 400, "no cycles in the page tree");
  assert.equal((await outsider.get(`/api/wiki/${page.body.id}`)).status, 404);
  const tree = await viewer.get<{ id: string; parentPageId: string | null }[]>(`/api/wikis/${s.wiki}/pages`);
  assert.equal(tree.body.length, 2);
  // Deleting a page soft-deletes its sub-pages too.
  assert.equal((await admin.del(`/api/wiki/${page.body.id}`)).status, 204);
  assert.equal((await viewer.get<unknown[]>(`/api/wikis/${s.wiki}/pages`)).body.length, 0);
  assert.equal(await prisma.wikiPage.count({ where: { wikiId: s.wiki, deletedAt: { not: null } } }), 2);
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

type Notif = { id: string; type: string; title: string; read: boolean; link: string | null; data: Record<string, unknown> | null };

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
  // Everyone else still sees it.
  assert.equal((await contributor.get(`/api/projects/${s.otherProject}`)).status, 200);

  // Promoting the member to admin clears the rule; so does un-hiding.
  assert.equal((await admin.put(`/api/projects/${s.otherProject}/visibility`, { hiddenUserIds: [] })).status, 200);
  assert.equal((await viewer.get(`/api/projects/${s.otherProject}`)).status, 200);
});

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3100";
const STUB = `http://localhost:${process.env.GEMINI_STUB_PORT ?? 3999}`;
const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function upload(client: Client, method: string, path: string, name: string, bytes: Uint8Array | string, type: string) {
  const form = new FormData();
  form.append("file", new Blob([bytes as BlobPart], { type }), name);
  const res = await fetch(`${BASE}${path}`, { method, body: form, headers: { cookie: client.cookieHeader() } });
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

async function ask(client: Client, body: Record<string, unknown>) {
  const res = await fetch(`${BASE}/api/ai/chat`, { method: "POST", headers: { cookie: client.cookieHeader(), "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, conversationId: res.headers.get("x-conversation-id"), text: await res.text() };
}

async function lastModelRequest() {
  return (await (await fetch(`${STUB}/last`)).json()) as { url: string; apiKey: string; body: { systemInstruction?: { parts: { text: string }[] }; contents: { role: string; parts: { text?: string }[] }[] } };
}

test("workspace logo: admins upload or generate one; it becomes the favicon and the link preview", async () => {
  const ws = (await admin.get<{ name: string; slug: string; logoUrl: string | null }>(`/api/workspaces/${s.ws}`)).body;
  s.wsSlug = ws.slug;
  assert.equal(ws.logoUrl, null);
  assert.equal((await upload(contributor, "PUT", `/api/workspaces/${s.ws}/logo`, "logo.png", PNG_1PX, "image/png")).status, 403);
  assert.equal((await upload(admin, "PUT", `/api/workspaces/${s.ws}/logo`, "logo.png", "not an image", "image/png")).status, 400, "content is sniffed, not trusted");
  const up = await upload(admin, "PUT", `/api/workspaces/${s.ws}/logo`, "logo.png", PNG_1PX, "image/png");
  assert.equal(up.status, 200);
  const logoUrl = up.body!.logoUrl as string;
  assert.match(logoUrl, new RegExp(`^/api/public/workspace-logo/${ws.slug}\\?v=\\d+$`));
  const img = await fetch(`${BASE}${logoUrl}`);
  assert.equal(img.headers.get("content-type"), "image/png");
  assert.equal(Buffer.from(await img.arrayBuffer()).length, PNG_1PX.length);
  // Browser tab icon inside the workspace.
  const page = await fetch(`${BASE}/w/${ws.slug}`, { headers: { cookie: admin.cookieHeader() } });
  assert.match(await page.text(), new RegExp(`<link rel="icon" href="${logoUrl.replace(/[?]/g, "\\?")}`));
  // Signed-out visitors (and link unfurlers) see the workspace name + logo on the sign-in page.
  const anon = await fetch(`${BASE}/w/${ws.slug}/my-work`, { redirect: "manual" });
  assert.equal(anon.status, 307);
  const loc = new URL(anon.headers.get("location")!, BASE);
  assert.equal(loc.searchParams.get("ws"), ws.slug);
  assert.equal(loc.searchParams.get("callbackUrl"), `/w/${ws.slug}/my-work`);
  const landing = await (await fetch(`${BASE}/?ws=${ws.slug}`)).text();
  assert.match(landing, /<meta property="og:image" content="[^"]*workspace-logo/);
  assert.ok(landing.includes(`<title>${ws.name} · woli.</title>`), "workspace name in the preview title");
  assert.equal((await admin.del(`/api/workspaces/${s.ws}/logo`)).status, 204);
  assert.equal((await fetch(`${BASE}${logoUrl}`)).status, 404);
});

test("wiki AI: managers set instructions and documents; members ask, grounded in this wiki only", async () => {
  await contributor.post(`/api/wikis/${s.wiki}/pages`, { title: "Leave policy" }).then((r) => contributor.patch(`/api/wiki/${(r.body as { id: string }).id}`, { content: "<p>Annual leave is 12 days.</p>" }));
  // Only the wiki's managers configure the assistant.
  assert.equal((await contributor.put(`/api/wikis/${s.wiki}/ai-settings`, { instructions: "x" })).status, 403);
  assert.equal((await admin.put(`/api/wikis/${s.wiki}/ai-settings`, { instructions: "You are the HR onboarding buddy. Answer in bullet points.", greeting: "Hi!" })).status, 200);
  const asViewer = await viewer.get<{ canManage: boolean; instructions?: string; greeting: string; configured: boolean }>(`/api/wikis/${s.wiki}/ai-settings`);
  assert.equal(asViewer.body.canManage, false);
  assert.equal(asViewer.body.instructions, undefined, "members don't see the system prompt");
  assert.equal(asViewer.body.greeting, "Hi!");
  assert.equal(asViewer.body.configured, true);

  assert.equal((await upload(contributor, "POST", `/api/wikis/${s.wiki}/knowledge-docs`, "handbook.txt", "x", "text/plain")).status, 403);
  assert.equal((await upload(admin, "POST", `/api/wikis/${s.wiki}/knowledge-docs`, "virus.exe", "MZ", "application/octet-stream")).status, 400);
  const txt = await upload(admin, "POST", `/api/wikis/${s.wiki}/knowledge-docs`, "handbook.txt", "Probation lasts 60 days. Laptop pickup at IT desk.", "text/plain");
  assert.equal(txt.status, 201, JSON.stringify(txt.body));
  const pdf = await upload(admin, "POST", `/api/wikis/${s.wiki}/knowledge-docs`, "policy.pdf", "%PDF-1.4 fake", "application/pdf");
  assert.equal(pdf.status, 201, "PDF text is transcribed by the model");
  const docs = await viewer.get<{ fileName: string; charCount: number }[]>(`/api/wikis/${s.wiki}/knowledge-docs`);
  assert.deepEqual(docs.body.map((d) => d.fileName).sort(), ["handbook.txt", "policy.pdf"]);
  assert.equal((await viewer.get(`/api/knowledge-docs/${pdf.body!.id}`)).status, 403, "extracted text preview is for managers");

  const a = await ask(viewer, { kind: "wiki", wikiId: s.wiki, message: "How long is probation?" });
  assert.equal(a.status, 200, a.text);
  assert.match(a.text, /You asked: How long is probation\?/);
  assert.ok(a.conversationId);
  const req = await lastModelRequest();
  assert.equal(req.apiKey, "integration-test-key", "key sent server-side in a header");
  assert.match(req.url, /gemini-9\.9-flash:streamGenerateContent\?alt=sse/, "retired models are skipped; a model is discovered from the key's model list");
  const system = req.body.systemInstruction!.parts[0].text;
  assert.match(system, /HR onboarding buddy/, "owner instructions");
  assert.match(system, /Probation lasts 60 days/, "uploaded document");
  assert.match(system, /leave policy is 12 days/i, "transcribed PDF");
  assert.match(system, /Wiki page: Leave policy[\s\S]*Annual leave is 12 days/, "wiki pages");
  assert.match(system, /Answer ONLY from the KNOWLEDGE/, "scope rule");
  assert.doesNotMatch(system, /Call the insurer/, "no data from other projects");

  // Follow-up keeps history; conversations are private.
  await ask(viewer, { kind: "wiki", wikiId: s.wiki, conversationId: a.conversationId, message: "And the laptop?" });
  assert.deepEqual((await lastModelRequest()).body.contents.map((c) => c.role), ["user", "model", "user"]);
  const conv = await viewer.get<{ messages: { role: string }[] }>(`/api/ai/conversations/${a.conversationId}`);
  assert.equal(conv.body.messages.length, 4);
  assert.equal((await contributor.get(`/api/ai/conversations/${a.conversationId}`)).status, 404);
  assert.equal((await ask(contributor, { kind: "wiki", wikiId: s.wiki, conversationId: a.conversationId, message: "hi" })).status, 404);
  assert.equal((await ask(outsider, { kind: "wiki", wikiId: s.wiki, message: "hi" })).status, 404);

  // Turning the assistant off blocks questions.
  await admin.put(`/api/wikis/${s.wiki}/ai-settings`, { enabled: false });
  assert.equal((await ask(viewer, { kind: "wiki", wikiId: s.wiki, message: "hi" })).status, 403);
  await admin.put(`/api/wikis/${s.wiki}/ai-settings`, { enabled: true });
});

test("wikis live at workspace level: restricted wikis, per-person roles, managers", async () => {
  // A contributor creates a private wiki: they manage it, others can't see it.
  const w = await contributor.post<{ id: string; access: string; myRole: string }>(`/api/workspaces/${s.ws}/wikis`, { name: "Payroll secrets", access: "restricted" });
  assert.equal(w.status, 201);
  assert.equal(w.body.myRole, "manager");
  const id = w.body.id;
  assert.equal((await viewer.post(`/api/workspaces/${s.ws}/wikis`, { name: "Nope" })).status, 403, "workspace viewers can't create wikis");
  const viewerList = await viewer.get<{ id: string }[]>(`/api/workspaces/${s.ws}/wikis`);
  assert.ok(!viewerList.body.some((x) => x.id === id), "hidden from people not added");
  assert.ok(viewerList.body.some((x) => x.id === s.wiki), "workspace-wide wiki is listed");
  assert.equal((await viewer.get(`/api/wikis/${id}/pages`)).status, 404);
  assert.equal((await admin.get(`/api/wikis/${id}`)).status, 200, "workspace admins see every wiki");
  const page = await contributor.post<{ id: string }>(`/api/wikis/${id}/pages`, { title: "Salary bands" });
  assert.equal((await viewer.get(`/api/wiki/${page.body.id}`)).status, 404);
  assert.equal((await ask(viewer, { kind: "wiki", wikiId: id, message: "hi" })).status, 404, "no AI on a wiki you can't open");

  // Only managers change access; only workspace members can be added.
  assert.equal((await viewer.put(`/api/wikis/${id}/members`, { members: [] })).status, 404);
  assert.equal((await contributor.put(`/api/wikis/${id}/members`, { members: [{ userId: s.outsiderId, role: "viewer" }] })).status, 400);
  assert.equal((await contributor.put(`/api/wikis/${id}/members`, { members: [{ userId: s.viewerId, role: "viewer" }] })).status, 200);
  assert.equal((await viewer.get(`/api/wiki/${page.body.id}`)).status, 200, "added as viewer: can read");
  assert.equal((await viewer.patch(`/api/wiki/${page.body.id}`, { title: "x" })).status, 403, "...but not edit");
  assert.equal((await viewer.patch(`/api/wikis/${id}`, { name: "x" })).status, 403);
  const members = await contributor.get<{ members: { id: string; role: string | null; lockedReason: string | null }[] }>(`/api/wikis/${id}/members`);
  assert.equal(members.body.members.find((m) => m.id === s.viewerId)!.role, "viewer");
  assert.equal(members.body.members.find((m) => m.id === s.contributorId)!.lockedReason, "creator");

  // Opening it to the workspace with "view" as default.
  assert.equal((await contributor.patch(`/api/wikis/${id}`, { access: "workspace", defaultRole: "viewer" })).status, 200);
  assert.equal((await admin.post(`/api/wikis/${id}/pages`, { title: "Admins still edit" })).status, 201);
  // Delete (soft) by a manager.
  assert.equal((await contributor.del(`/api/wikis/${id}`)).status, 204);
  assert.equal((await viewer.get(`/api/wikis/${id}`)).status, 404);
  assert.ok(await prisma.wiki.findUnique({ where: { id } }), "row kept");
});

test("a new project starts with a single blank task table", async () => {
  const p = await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/projects`, { name: "Blank project" });
  const detail = await admin.get<{ views: { type: string; isDefault: boolean }[] }>(`/api/projects/${p.body.id}`);
  assert.deepEqual(detail.body.views.map((v) => [v.type, v.isDefault]), [["grid", true]]);
  assert.equal(await prisma.task.count({ where: { projectId: p.body.id } }), 0);
  assert.equal((await admin.del(`/api/projects/${p.body.id}`)).status, 204);
});

test("AI overload: busy models are retried; if Gemini stays busy nothing is saved", async () => {
  const before = await prisma.aiConversation.count();
  const once = await ask(admin, { kind: "assistant", workspaceId: s.ws, message: "report #overload-once" });
  assert.equal(once.status, 200, "a 503 is retried on the same model");
  assert.match(once.text, /You asked: report #overload-once/);
  assert.equal((await (await fetch(`${STUB}/count?q=${encodeURIComponent("report #overload-once")}`)).json()).count, 2);

  const always = await ask(admin, { kind: "assistant", workspaceId: s.ws, message: "report #overload-always" });
  assert.equal(always.status, 503);
  const err = JSON.parse(always.text).error as string;
  assert.match(err, /overloaded/);
  assert.match(err, /tried gemini-9\.9-flash: 503, retired-model: 404, retired-fallback: 404/, "the model that last worked goes first, then every other model is tried");
  assert.equal(await prisma.aiConversation.count(), before + 1, "only the successful chat was saved");
});

test("AI assistant: answers from what the user may see, declines the rest, and enforces a daily quota", async () => {
  // Hide the other project from the viewer: its tasks must not reach the model.
  await admin.put(`/api/projects/${s.otherProject}/visibility`, { hiddenUserIds: [s.viewerId] });
  const r = await ask(viewer, { kind: "assistant", workspaceId: s.ws, message: "Write this week's progress report" });
  assert.equal(r.status, 200, r.text);
  const system = (await lastModelRequest()).body.systemInstruction!.parts[0].text;
  assert.match(system, /Onboarding Q4/);
  assert.match(system, /Payroll reconciliation/, "tasks of visible projects");
  assert.match(system, /Probation lasts 60 days/, "wiki documents of visible projects");
  assert.doesNotMatch(system, /Call the insurer|Other project/, "hidden project stays out");
  assert.match(system, /decline in one or two sentences/, "out-of-scope rule");
  await admin.put(`/api/projects/${s.otherProject}/visibility`, { hiddenUserIds: [] });
  // Wikis the user can't open stay out too.
  const secret = await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/wikis`, { name: "Board notes", access: "restricted" });
  await admin.post<{ id: string }>(`/api/wikis/${secret.body.id}/pages`, { title: "Board-only acquisition plan" });
  await ask(viewer, { kind: "assistant", workspaceId: s.ws, message: "anything secret?" });
  assert.doesNotMatch((await lastModelRequest()).body.systemInstruction!.parts[0].text, /acquisition plan/);
  const again = await ask(admin, { kind: "assistant", workspaceId: s.ws, message: "report" });
  assert.equal(again.status, 200);
  const adminPrompt = (await lastModelRequest()).body.systemInstruction!.parts[0].text;
  assert.match(adminPrompt, /Call the insurer/, "admins see everything");
  assert.match(adminPrompt, /Board notes/, "including restricted wikis");

  assert.equal((await ask(outsider, { kind: "assistant", workspaceId: s.ws, message: "hi" })).status, 404);
  const list = await viewer.get<{ items: { id: string }[] }>(`/api/ai/conversations?kind=assistant&workspaceId=${s.ws}`);
  assert.equal(list.body.items.length, 2, "one per new chat");

  // AI_DAILY_LIMIT=6 in the test environment; the viewer has asked 2 wiki + 2 assistant questions so far (rejected requests don't count).
  let status = 200;
  for (let i = 0; i < 3 && status === 200; i++) status = (await ask(viewer, { kind: "assistant", workspaceId: s.ws, message: `q${i}` })).status;
  assert.equal(status, 429);
  const saved = await prisma.aiMessage.findFirst({ where: { role: "model", conversation: { userId: s.viewerId } }, orderBy: { createdAt: "desc" } });
  assert.equal(saved?.tokensIn, 111, "token usage recorded");
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

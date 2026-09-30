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
  // AI is opt-in per workspace: nothing is sent to the AI provider until an admin switches it on.
  const ws0 = await admin.get<{ aiEnabled: boolean }>(`/api/workspaces/${s.ws}`);
  assert.equal(ws0.body.aiEnabled, false);
  const off = await admin.post<{ code: string }>(`/api/workspaces/${s.ws}/brain/insights`, {});
  assert.equal(off.status, 403);
  assert.equal(off.body.code, "ai_disabled");
  assert.equal((await admin.patch<{ aiEnabled: boolean }>(`/api/workspaces/${s.ws}`, { aiEnabled: true })).body.aiEnabled, true);
});

test("owners invite people by email - they join only after accepting; any user can create their own workspaces", async () => {
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
  // A temporary password only opens the "choose a new password" endpoint - every other API refuses.
  const blocked = await outsider.get<{ code: string }>("/api/workspaces");
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, "password_change_required");
  assert.equal((await outsider.post("/api/account/password", { currentPassword: s.outsiderPw, newPassword: "Outsider123" })).status, 200);
  assert.equal((await outsider.get("/api/workspaces")).status, 200, "the same device keeps working after its own password change");

  // Nobody is added directly: they get an invitation and join only after accepting.
  const inv = await admin.post<{ invitations: { email: string; status: string; url: string; hasAccount: boolean }[] }>(`/api/workspaces/${s.ws}/members`, {
    emails: ["contributor@integration.test", "VIEWER@integration.test"],
    role: "contributor",
    message: "Welcome to the HR team",
  });
  assert.equal(inv.status, 201, JSON.stringify(inv.body));
  assert.deepEqual(inv.body.invitations.map((i) => [i.email, i.status, i.hasAccount]), [["contributor@integration.test", "invited", true], ["viewer@integration.test", "invited", true]]);
  // Password sign-ups haven't proven they own the address: no email invitation until it is verified.
  assert.equal((v.body as { verification?: string }).verification, "unavailable", "no mail provider in tests");
  assert.equal((await viewer.get<{ items: { type: string }[] }>("/api/notifications")).body.items.filter((n) => n.type === "workspace_invite").length, 0, "unverified accounts don't see email invitations");
  const pendingTok = (await prisma.workspaceInvitation.findFirstOrThrow({ where: { workspaceId: s.ws, email: "viewer@integration.test" } })).token;
  const unverified = await viewer.post<{ code: string }>(`/api/invite/${pendingTok}`, { decision: "accept" });
  assert.equal(unverified.status, 403);
  assert.equal(unverified.body.code, "email_unverified");
  assert.equal((await contributor.patch(`/api/admin/users/${s.viewerId}`, { verifyEmail: true })).status, 403, "only system admins confirm addresses");
  for (const id of [s.contributorId, s.viewerId]) assert.equal((await admin.patch(`/api/admin/users/${id}`, { verifyEmail: true })).status, 200);
  assert.ok((await prisma.user.findUniqueOrThrow({ where: { id: s.viewerId } })).emailVerifiedAt);
  assert.equal(await prisma.workspaceMember.count({ where: { workspaceId: s.ws, userId: s.viewerId } }), 0, "not a member before accepting");
  assert.equal((await viewer.get(`/api/workspaces/${s.ws}`)).status, 404);
  const vNotif = (await viewer.get<{ items: { type: string; link: string }[] }>("/api/notifications")).body.items.find((n) => n.type === "workspace_invite");
  assert.ok(vNotif, "invitee sees it in the Action Center");
  // A personal link only works for its own email.
  assert.equal((await contributor.post(`/api/invite/${vNotif!.link.split("/invite/")[1]}`, { decision: "accept" })).status, 403);
  // Re-inviting with another role updates the pending invitation instead of duplicating it.
  const again = await admin.post<{ invitations: { status: string }[] }>(`/api/workspaces/${s.ws}/members`, { email: "viewer@integration.test", role: "viewer" });
  assert.equal(again.body.invitations[0].status, "reinvited");
  assert.equal(await prisma.workspaceInvitation.count({ where: { workspaceId: s.ws, email: "viewer@integration.test", status: "pending" } }), 1);
  for (const [client, email] of [[contributor, "contributor@integration.test"], [viewer, "viewer@integration.test"]] as const) {
    const token = inv.body.invitations.find((i) => i.email === email)!.url.split("/invite/")[1];
    const info = await client.get<{ state: string; role: string; workspace: { name: string } }>(`/api/invite/${token}`);
    assert.equal(info.body.state, "pending");
    const ok = await client.post<{ joined: boolean; slug: string }>(`/api/invite/${token}`, { decision: "accept" });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.ok(ok.body.joined && ok.body.slug);
  }
  assert.equal((await prisma.workspaceMember.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: s.ws, userId: s.viewerId } } })).role, "viewer", "joins with the latest invited role");
  const accepted = await prisma.notification.findFirst({ where: { type: "workspace_invite_result", actorId: s.viewerId } });
  assert.equal((accepted!.data as { decision: string }).decision, "accepted", "the inviter hears back");
  assert.equal((await admin.post<{ invitations: { status: string }[] }>(`/api/workspaces/${s.ws}/members`, { email: "viewer@integration.test", role: "viewer" })).body.invitations[0].status, "already_member");
  assert.equal((await admin.post(`/api/workspaces/${s.ws}/members`, { email: "x@y.zz", role: "owner" })).status, 400, "owners are made after joining");
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
  assert.equal((await admin.get(`/api/workspaces/${s.contributorWs}`)).status, 404, "system admins see tenant content only as members (support access is break-glass: ADMIN_SUPPORT_ACCESS=1)");
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
  assert.ok(landing.includes(`<title>${ws.name} · woli</title>`), "workspace name in the preview title");
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

  // Editors of the wiki add documents too (and may remove their own); readers can't.
  assert.equal((await upload(viewer, "POST", `/api/wikis/${s.wiki}/knowledge-docs`, "notes.txt", "x", "text/plain")).status, 403);
  const deck = await upload(contributor, "POST", `/api/wikis/${s.wiki}/knowledge-docs`, "notes.md", "# Draft", "text/markdown");
  assert.equal(deck.status, 201, JSON.stringify(deck.body));
  assert.equal((await contributor.del(`/api/knowledge-docs/${deck.body!.id}`)).status, 204, "the uploader removes their own document");
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

async function action(client: Client, body: Record<string, unknown>) {
  const res = await fetch(`${BASE}/api/ai/action`, { method: "POST", headers: { cookie: client.cookieHeader(), "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, type: res.headers.get("content-type") ?? "", text: await res.text() };
}
type NotifList = { unread: number; items: { id: string; type: string; taskId: string | null; actioned: boolean; snoozedUntil: string | null }[] };

test("comments: @mentions notify only people who can see the task", async () => {
  const t = await admin.post<Rec>(`/api/projects/${s.project}/tasks`, { data: { sys_title: "Prepare offer letters", sys_assignees: [s.contributorId] } });
  assert.equal(t.status, 201, JSON.stringify(t.body));
  s.r6task = t.body.id;
  const people = await contributor.get<{ id: string }[]>(`/api/tasks/${s.r6task}/mentionable`);
  assert.ok(people.body.some((p) => p.id === s.viewerId));
  assert.ok(!people.body.some((p) => p.id === s.outsiderId), "outsiders can't be tagged");
  const c = await contributor.post<{ id: string }>(`/api/tasks/${s.r6task}/comments`, { body: `Please check @[Vic Viewer](${s.viewerId}) and @[Out](${s.outsiderId})` });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const rows = await prisma.commentMention.findMany({ where: { commentId: c.body.id } });
  assert.deepEqual(rows.map((r) => r.userId), [s.viewerId]);
  const inbox = await viewer.get<NotifList>("/api/notifications?view=todo");
  assert.ok(inbox.body.items.some((n) => n.type === "mention" && n.taskId === s.r6task));
  assert.equal(await prisma.notification.count({ where: { userId: s.outsiderId, type: "mention" } }), 0);
});

test("action center: snooze hides an item, done clears it, due-date changes reach the assignee", async () => {
  const inbox = await viewer.get<NotifList>("/api/notifications?view=todo");
  const n = inbox.body.items.find((x) => x.type === "mention")!;
  const later = new Date(Date.now() + 3600_000).toISOString();
  assert.equal((await viewer.patch(`/api/notifications/${n.id}`, { snoozeUntil: later })).status, 200);
  assert.ok(!(await viewer.get<NotifList>("/api/notifications?view=todo")).body.items.some((x) => x.id === n.id), "snoozed items leave To do");
  assert.ok((await viewer.get<NotifList>("/api/notifications?view=snoozed")).body.items.some((x) => x.id === n.id));
  await viewer.patch(`/api/notifications/${n.id}`, { snoozeUntil: null, actioned: true });
  assert.ok(!(await viewer.get<NotifList>("/api/notifications?view=todo")).body.items.some((x) => x.id === n.id), "done items leave To do");
  assert.ok((await viewer.get<NotifList>("/api/notifications?view=all")).body.items.some((x) => x.id === n.id && x.actioned));
  assert.equal((await outsider.patch(`/api/notifications/${n.id}`, { read: true })).status, 404, "someone else's notification");

  await admin.patch(`/api/tasks/${s.r6task}`, { data: { sys_due_date: "2031-03-15" } });
  const due = await prisma.notification.findFirst({ where: { userId: s.contributorId, taskId: s.r6task, type: "task_due_changed" } });
  assert.ok(due, "assignee told about the new deadline");
  assert.equal((due!.data as { date: string }).date, "2031-03-15");
});

test("quick actions: start / plan / complete follow the same permissions as edits", async () => {
  assert.equal((await viewer.post(`/api/tasks/${s.r6task}/quick`, { action: "start" })).status, 403, "viewers can't edit");
  const started = await contributor.post<Rec>(`/api/tasks/${s.r6task}/quick`, { action: "start" });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const plan = await contributor.post<Rec>(`/api/tasks/${s.r6task}/quick`, { action: "plan" });
  assert.equal(plan.body.data.sys_start_date, new Date().toISOString().slice(0, 10));
  const task = await prisma.task.findUniqueOrThrow({ where: { id: s.r6task }, include: { status: true } });
  assert.equal(task.status.category, "in_progress");
});

test("focus sessions: one running session at a time; completing adds the minutes to actual hours", async () => {
  const a = await contributor.post<{ id: string; status: string; plannedMinutes: number }>(`/api/tasks/${s.r6task}/focus`, {});
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(a.body.status, "running");
  const other = await admin.post<Rec>(`/api/projects/${s.project}/tasks`, { data: { sys_title: "Second focus task", sys_assignees: [s.contributorId] } });
  const b = await contributor.post<{ id: string }>(`/api/tasks/${other.body.id}/focus`, {});
  assert.equal((await prisma.focusSession.findUniqueOrThrow({ where: { id: a.body.id } })).status, "paused", "starting another one pauses the first");
  assert.equal((await contributor.patch(`/api/focus/${b.body.id}`, { action: "cancel" })).status, 200);
  await contributor.patch(`/api/focus/${a.body.id}`, { action: "resume" });
  assert.equal((await viewer.patch(`/api/focus/${a.body.id}`, { action: "pause" })).status, 404, "only the owner");
  // 25 minutes focused.
  await prisma.focusSession.update({ where: { id: a.body.id }, data: { elapsedSeconds: 25 * 60, resumedAt: new Date() } });
  const done = await contributor.patch<{ status: string }>(`/api/focus/${a.body.id}`, { action: "complete", notes: "Drafted 3 letters" });
  assert.equal(done.body.status, "completed");
  const task = await prisma.task.findUniqueOrThrow({ where: { id: s.r6task } });
  assert.ok(task.actualMinutes! >= 25 && task.actualMinutes! <= 26, `actual minutes ${task.actualMinutes}`);
  const grid = await contributor.get<Rec[]>(`/api/projects/${s.project}/tasks`);
  const rec = grid.body.find((r) => r.id === s.r6task)!;
  assert.ok(Number(rec.data.sys_actual) >= 0.4, "shown as hours in the grid");
});

test("universal search covers tasks, projects, wikis, objectives and people - within what the user can see", async () => {
  const r = await admin.get<{ tasks: { id: string }[]; projects: unknown[]; people: { id: string }[]; objectives: unknown[] }>(`/api/search?workspaceId=${s.ws}&q=offer`);
  assert.ok(r.body.tasks.some((t) => t.id === s.r6task));
  const people = await admin.get<{ people: { id: string }[] }>(`/api/search?workspaceId=${s.ws}&q=viewer`);
  assert.ok(people.body.people.some((p) => p.id === s.viewerId));
  await admin.put(`/api/projects/${s.project}/visibility`, { hiddenUserIds: [s.viewerId] });
  const hidden = await viewer.get<{ tasks: unknown[] }>(`/api/search?workspaceId=${s.ws}&q=offer`);
  assert.equal(hidden.body.tasks.length, 0, "hidden project stays out of search");
  await admin.put(`/api/projects/${s.project}/visibility`, { hiddenUserIds: [] });
  assert.equal((await outsider.get(`/api/search?workspaceId=${s.ws}&q=offer`)).status, 404);
});

test("key results carry confidence and a deadline", async () => {
  const r = await admin.patch<{ keyResults: { id: string; confidence: number; dueDate: string | null }[] }>(`/api/key-results/${s.krLaptop}`, { confidence: 40, dueDate: "2031-12-31" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const kr = r.body.keyResults.find((k) => k.id === s.krLaptop)!;
  assert.equal(kr.confidence, 40);
  assert.equal(kr.dueDate, "2031-12-31");
  assert.equal((await admin.patch(`/api/key-results/${s.krLaptop}`, { confidence: 140 })).status, 400);
});

test("embedded AI actions: grounded in the target, personalized, and never outside the user's access", async () => {
  const prof = await admin.patch<{ aiTone: string }>("/api/account/profile", { jobTitle: "HR Director", aiInstructions: "Always end with a one-line takeaway.", aiTone: "concise", aiLength: "short" });
  assert.equal(prof.status, 200, JSON.stringify(prof.body));
  const sum = await action(admin, { action: "task_summarize", targetId: s.r6task });
  assert.equal(sum.status, 200, sum.text);
  const system = (await lastModelRequest()).body.systemInstruction!.parts[0].text;
  assert.match(system, /Prepare offer letters/, "the task is in the context");
  assert.match(system, /Always end with a one-line takeaway/, "custom instructions");
  assert.match(system, /very concise/, "tone");
  assert.match(system, /PERMISSION SCOPE/, "scope guard on every prompt");
  assert.equal((await action(outsider, { action: "task_summarize", targetId: s.r6task })).status, 404);

  const br = await action(admin, { action: "task_breakdown", targetId: s.r6task });
  assert.equal(br.status, 200);
  assert.match(br.type, /application\/json/);
  assert.equal((JSON.parse(br.text) as { items: unknown[] }).items.length, 2);

  const brief = await action(contributor, { action: "home_brief", targetId: s.ws });
  assert.equal(brief.status, 200);
  assert.match((await lastModelRequest()).body.systemInstruction!.parts[0].text, /Prepare offer letters/, "my day includes my tasks");
  assert.equal((await action(outsider, { action: "home_brief", targetId: s.ws })).status, 404);
  assert.equal((await action(admin, { action: "dash_explain", targetId: s.project, targetKind: "project" })).status, 400, "dashboard actions need the chart data");
});

test("AI dashboard builder: only valid chart specs over real fields are kept", async () => {
  const rep = await admin.post<{ widgets: { id: string; dimensionFieldId: string }[] }>("/api/ai/build-widgets", { target: "report", projectId: s.project, prompt: "status overview and workload" });
  assert.equal(rep.status, 200, JSON.stringify(rep.body));
  assert.deepEqual(rep.body.widgets.map((w) => w.dimensionFieldId), ["sys_status", "sys_assignees"], "the made-up field is dropped");
  assert.equal((await viewer.post("/api/ai/build-widgets", { target: "report", projectId: s.project, prompt: "status overview" })).status, 403, "editors only");
  const d = await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/dashboards`, { name: "AI built" });
  const built = await admin.post<{ widgets: unknown[] }>("/api/ai/build-widgets", { target: "dashboard", dashboardId: d.body.id, prompt: "status overview" });
  assert.equal(built.status, 201, JSON.stringify(built.body));
  assert.equal(await prisma.dashboardWidget.count({ where: { dashboardId: d.body.id } }), 2);
});

test("wiki comments: mentions, replies, delete rights, and the wiki AI reads the discussion", async () => {
  const page = await admin.post<{ id: string }>(`/api/wikis/${s.wiki}/pages`, { title: "Leave policy" });
  assert.equal(page.status, 201);
  const people = await viewer.get<{ id: string }[]>(`/api/wiki/${page.body.id}/mentionable`);
  assert.ok(people.body.some((p) => p.id === s.contributorId));
  const c = await viewer.post<{ id: string }>(`/api/wiki/${page.body.id}/comments`, { body: `**Question** for @[Casey Contributor](${s.contributorId}): does sick leave need a certificate after 2 days?` });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.ok(await prisma.notification.findFirst({ where: { userId: s.contributorId, type: "mention", link: { contains: page.body.id } } }), "mentioned person notified");
  const reply = await contributor.post<{ id: string }>(`/api/wiki/${page.body.id}/comments`, { body: "Yes, from day 3.", parentCommentId: c.body.id });
  assert.equal(reply.status, 201);
  assert.equal((await outsider.get(`/api/wiki/${page.body.id}/comments`)).status, 404);
  assert.equal((await contributor.del(`/api/wiki-comments/${c.body.id}`)).status, 403, "not the author, not a manager");
  const list = await viewer.get<unknown[]>(`/api/wiki/${page.body.id}/comments`);
  assert.equal(list.body.length, 2);
  const r = await ask(admin, { kind: "wiki", wikiId: s.wiki, message: "What does the discussion say about sick leave?" });
  assert.equal(r.status, 200, r.text);
  assert.match((await lastModelRequest()).body.systemInstruction!.parts[0].text, /certificate after 2 days/, "comments are part of the wiki's knowledge");
  assert.equal((await admin.del(`/api/wiki-comments/${c.body.id}`)).status, 204, "managers can delete");
});

test("profile & appearance: avatars are visible to co-members only; theme mode and tone are validated", async () => {
  const svg = await fetch(`${BASE}/api/users/${s.viewerId}/avatar`, { headers: { cookie: admin.cookieHeader() } });
  assert.equal(svg.status, 200);
  assert.match(svg.headers.get("content-type") ?? "", /image\/svg\+xml/);
  assert.match(await svg.text(), /VV/, "initials when no picture was uploaded");
  assert.equal((await fetch(`${BASE}/api/users/${s.viewerId}/avatar`, { headers: { cookie: outsider.cookieHeader() } })).status, 404);
  assert.equal((await admin.patch("/api/account/preferences", { themeMode: "system", surfaceTone: "ocean" })).status, 200);
  assert.equal((await admin.patch("/api/account/preferences", { surfaceTone: "neon" })).status, 400);
  const sized = await admin.patch<{ fontSize: string; displaySize: string }>("/api/account/preferences", { fontSize: "lg", displaySize: "compact" });
  assert.equal(sized.status, 200);
  assert.deepEqual([sized.body.fontSize, sized.body.displaySize], ["lg", "compact"], "text and display size are saved");
  assert.equal((await admin.patch("/api/account/preferences", { fontSize: "huge" })).status, 400);
  assert.equal((await admin.patch("/api/account/preferences", { displaySize: "200%" })).status, 400);
  const home = await fetch(`${BASE}/workspaces`, { headers: { cookie: admin.cookieHeader() } });
  assert.match(await home.text(), /data-font-size="lg"[^>]*data-display="compact"/, "rendered on <html> by the server");
  await admin.patch("/api/account/preferences", { fontSize: "md", displaySize: "default" });
  const u = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
  assert.equal(u.surfaceTone, "ocean");
  assert.equal((await admin.patch("/api/account/profile", { aiTone: "sarcastic" })).status, 400);
});

test("approvals: request, approve from the Action Center, and optionally complete the task", async () => {
  // An earlier test removes "Done"; completing on approval needs a done-category status.
  const statuses = (await admin.get<{ category: string }[]>(`/api/workspaces/${s.ws}/statuses`)).body;
  if (!statuses.some((x) => x.category === "done")) assert.equal((await admin.post(`/api/workspaces/${s.ws}/statuses`, { name: "Done", category: "done" })).status, 201);
  const people = await contributor.get<{ id: string }[]>(`/api/tasks/${s.r6task}/mentionable`);
  assert.ok(people.body.some((p) => p.id === s.viewerId));
  assert.equal((await viewer.post(`/api/tasks/${s.r6task}/approvals`, { approverId: s.contributorId })).status, 403, "viewers can't request approvals");
  assert.equal((await contributor.post(`/api/tasks/${s.r6task}/approvals`, { approverId: s.contributorId })).status, 400, "not yourself");
  assert.equal((await contributor.post(`/api/tasks/${s.r6task}/approvals`, { approverId: s.outsiderId })).status, 400, "approver must be a member");
  const req = await contributor.post<{ id: string; status: string }>(`/api/tasks/${s.r6task}/approvals`, { approverId: s.viewerId, note: "Please check the offer amounts", completeOnApprove: true });
  assert.equal(req.status, 201, JSON.stringify(req.body));
  assert.equal((await contributor.post(`/api/tasks/${s.r6task}/approvals`, { approverId: s.viewerId })).status, 409, "one pending request per approver");
  const inbox = await viewer.get<NotifList>("/api/notifications?view=todo");
  const n = inbox.body.items.find((x) => x.type === "approval_request" && x.taskId === s.r6task);
  assert.ok(n, "approver sees it in To do");
  assert.equal((await contributor.patch(`/api/approvals/${req.body.id}`, { decision: "approve" })).status, 403, "only the approver decides");
  const ok = await viewer.patch<{ status: string }>(`/api/approvals/${req.body.id}`, { decision: "approve", note: "Looks good" });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.status, "approved");
  const task = await prisma.task.findUniqueOrThrow({ where: { id: s.r6task }, include: { status: true } });
  assert.equal(task.status.category, "done", "completed on approval, even though the approver is a viewer");
  assert.ok(!(await viewer.get<NotifList>("/api/notifications?view=todo")).body.items.some((x) => x.id === n!.id), "request leaves the approver's To do");
  const result = await prisma.notification.findFirst({ where: { userId: s.contributorId, type: "approval_result", taskId: s.r6task } });
  assert.equal((result!.data as { decision: string }).decision, "approved", "requester told the result");
  assert.equal((await viewer.patch(`/api/approvals/${req.body.id}`, { decision: "reject" })).status, 400, "already decided");
  const list = await contributor.get<{ status: string }[]>(`/api/tasks/${s.r6task}/approvals`);
  assert.equal(list.body[0].status, "approved");
});

test("AI suggestions: rule-based nudges that open the matching AI action, created once", async () => {
  const big = await admin.post<Rec>(`/api/projects/${s.project}/tasks`, { data: { sys_title: "Redesign the onboarding programme", sys_assignees: [s.contributorId], sys_estimate: 12 } });
  assert.equal(big.status, 201, JSON.stringify(big.body));
  await contributor.get("/api/notifications");
  await contributor.get("/api/notifications");
  const rows = await prisma.notification.findMany({ where: { userId: s.contributorId, type: "ai_suggestion", taskId: big.body.id } });
  assert.equal(rows.length, 1, "deduplicated");
  assert.equal((rows[0].data as { kind: string }).kind, "task_breakdown");
  assert.match(rows[0].link!, /\?ai=task_breakdown$/);
});

test("project icons: optional, chosen from the basic set", async () => {
  const none = await admin.post<{ id: string; icon: string | null }>(`/api/workspaces/${s.ws}/projects`, { name: "No icon project" });
  assert.equal(none.status, 201, JSON.stringify(none.body));
  assert.equal(none.body.icon, null, "no icon unless the user picks one");
  assert.equal((await admin.patch(`/api/projects/${none.body.id}`, { icon: "not-an-icon" })).status, 400);
  const set = await admin.patch<{ icon: string | null }>(`/api/projects/${none.body.id}`, { icon: "rocket" });
  assert.equal(set.body.icon, "rocket");
  assert.equal((await admin.patch<{ icon: string | null }>(`/api/projects/${none.body.id}`, { icon: null })).body.icon, null, "can be cleared");
});

test("dashboard drill-down: a clicked segment lists exactly the tasks it counts", async () => {
  const d = await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/dashboards`, { name: "Drill-down" });
  const block = await admin.post<{ id: string }>(`/api/dashboards/${d.body.id}/blocks`, { type: "column", title: "By status", config: { dataSource: { projectId: s.project }, dimensionFieldId: "sys_status", aggregation: "count" } });
  assert.equal(block.status, 201, JSON.stringify(block.body));
  const data = await viewer.post<{ series: { key: string; label: string; value: number }[] }>(`/api/dashboard-blocks/${block.body.id}/data`, {});
  const point = data.body.series[0];
  assert.ok(point && point.value > 0, JSON.stringify(data.body));
  const res = await viewer.post<{ tasks: { id: string; title: string; status: { label: string } | null }[]; total: number }>(`/api/dashboard-blocks/${block.body.id}/records`, { segment: { key: point.key, label: point.label } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.total, point.value, "adds up to the bar");
  assert.ok(res.body.tasks.every((x) => x.status?.label === point.label));
  const kpi = await viewer.post<{ total: number }>(`/api/dashboard-blocks/${block.body.id}/records`, { segment: { key: "nope", label: "nope" } });
  assert.equal(kpi.body.total, 0);
  assert.equal((await outsider.post(`/api/dashboard-blocks/${block.body.id}/records`, { segment: { key: point.key, label: point.label } })).status, 404, "outsiders see nothing");
  assert.equal((await viewer.post(`/api/dashboard-blocks/${block.body.id}/records`, {})).status, 400, "segment required");
});

test("My OKRs show only the viewer's own branch: objective -> their key result -> their tasks", async () => {
  type Obj = { id: string; keyResults: { id: string; title: string; tasks: { taskId: string }[] }[]; tasks: { taskId: string }[] };
  const o = await admin.post<Obj>(`/api/workspaces/${s.ws}/objectives`, {
    title: "Branch visibility",
    projectId: s.project,
    keyResults: [{ title: "KR owned by contributor", ownerId: s.contributorId }, { title: "KR with tasks" }],
  });
  assert.equal(o.status, 201, JSON.stringify(o.body));
  const [krC, krT] = o.body.keyResults;
  const adminId = (await prisma.user.findUniqueOrThrow({ where: { email: "admin@integration.test" } })).id;
  const mk = async (title: string, assignee: string, target: string) => {
    const r = await admin.post<Rec>(`/api/projects/${s.project}/tasks`, { data: { sys_title: title, sys_assignees: [assignee], sys_objective: target } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.id;
  };
  const vTask = await mk("Viewer's branch task", s.viewerId, `kr:${krT.id}`);
  const otherTask = await mk("Someone else's task", s.contributorId, `kr:${krT.id}`);
  const cOnKrC = await mk("Admin task under contributor KR", adminId, `kr:${krC.id}`);
  const find = async (c: Client) => (await c.get<Obj[]>(`/api/workspaces/${s.ws}/objectives?mine=1`)).body.find((x) => x.id === o.body.id);

  const v = await find(viewer);
  assert.ok(v, "assignee sees the objective of their task");
  assert.deepEqual(v!.keyResults.map((k) => k.id), [krT.id], "only the key result holding their task");
  assert.deepEqual(v!.keyResults[0].tasks.map((x) => x.taskId), [vTask], "only their own task");

  const c = await find(contributor);
  assert.deepEqual(c!.keyResults.map((k) => k.id).sort(), [krC.id, krT.id].sort(), "own KR + KR holding their task");
  assert.deepEqual(c!.keyResults.find((k) => k.id === krC.id)!.tasks.map((x) => x.taskId), [cOnKrC], "a KR owner sees every task of that KR");
  assert.deepEqual(c!.keyResults.find((k) => k.id === krT.id)!.tasks.map((x) => x.taskId), [otherTask]);

  const detail = await viewer.get<Obj>(`/api/objectives/${o.body.id}?mine=1`);
  assert.deepEqual(detail.body.keyResults.map((k) => k.id), [krT.id], "detail opened from My OKRs is pruned too");
  assert.equal((await viewer.get<Obj>(`/api/objectives/${o.body.id}`)).body.keyResults.length, 2, "Team view unchanged");
});

test("wiki pages that quote a hidden project are hidden too - in the UI, search and AI answers", async () => {
  await admin.put(`/api/projects/${s.otherProject}/visibility`, { hiddenUserIds: [s.viewerId] });
  const wiki = await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/wikis`, { name: "Team reports", access: "workspace" });
  // What happened in production: a workspace-wide report (built by someone who sees every project) saved as a wiki page.
  const report = await admin.post<{ id: string }>(`/api/wikis/${wiki.body.id}/pages`, {
    title: "Weekly report - whole workspace",
    content: "<h2>Other project</h2><table><tr><td>Call the insurer</td><td>In Progress</td></tr></table><p>Budget review: pending</p>",
  });
  assert.equal(report.status, 201, JSON.stringify(report.body));
  const clean = await admin.post<{ id: string }>(`/api/wikis/${wiki.body.id}/pages`, { title: "Leave policy", content: "<p>Twelve days a year.</p>" });

  assert.equal((await viewer.get(`/api/wiki/${report.body.id}`)).status, 404, "hidden from the viewer");
  assert.equal((await viewer.get(`/api/wiki/${clean.body.id}`)).status, 200);
  const tree = (await viewer.get<{ id: string }[]>(`/api/wikis/${wiki.body.id}/pages`)).body.map((p) => p.id);
  assert.ok(!tree.includes(report.body.id) && tree.includes(clean.body.id), "left out of the page tree");
  assert.equal((await viewer.get<{ pages: unknown[] }>(`/api/search?workspaceId=${s.ws}&q=Weekly%20report`)).body.pages.length, 0, "and out of search");
  assert.equal((await viewer.get(`/api/wiki/${report.body.id}/comments`)).status, 404);
  const own = await admin.get<{ restrictedTo: { name: string }[] }>(`/api/wiki/${report.body.id}`);
  assert.deepEqual(own.body.restrictedTo.map((p) => p.name), ["Other project"], "people who can see it get a notice");

  await prisma.aiMessage.deleteMany({ where: { conversation: { userId: s.viewerId } } }); // reset the daily quota used up earlier
  assert.equal((await ask(viewer, { kind: "assistant", workspaceId: s.ws, message: "report on Other project" })).status, 200);
  let system = (await lastModelRequest()).body.systemInstruction!.parts[0].text;
  assert.match(system, /Leave policy/, "other wiki pages still reach the AI");
  assert.doesNotMatch(system, /Call the insurer|Weekly report - whole workspace/, "the quoting page doesn't");
  assert.equal((await ask(viewer, { kind: "wiki", wikiId: wiki.body.id, message: "what's in the weekly report?" })).status, 200);
  system = (await lastModelRequest()).body.systemInstruction!.parts[0].text;
  assert.doesNotMatch(system, /Call the insurer/, "nor through the wiki's own assistant");

  // A comment quoting the hidden project restricts a page that was fine before; mentioning the viewer doesn't notify them.
  const c = await admin.post(`/api/wiki/${clean.body.id}/comments`, { body: `@[Vic](${s.viewerId}) see Call the insurer` });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.equal((await viewer.get(`/api/wiki/${clean.body.id}`)).status, 404);
  assert.equal(await prisma.notification.count({ where: { userId: s.viewerId, type: "mention", data: { path: ["where"], equals: "wiki" }, title: "Leave policy" } }), 0);

  // Unhiding the project gives the pages back.
  await admin.put(`/api/projects/${s.otherProject}/visibility`, { hiddenUserIds: [] });
  assert.equal((await viewer.get(`/api/wiki/${report.body.id}`)).status, 200);
  assert.deepEqual((await admin.get<{ restrictedTo: unknown[] }>(`/api/wiki/${report.body.id}`)).body.restrictedTo, [], "no notice when nobody is hidden");
});

test("knowledge graph: built from existing relations, filtered by access, with a local view around one node", async () => {
  type G = { nodes: { id: string; type: string; depth?: number; href?: string; degree: number }[]; links: { source: string; target: string; kind: string }[]; focus?: string };
  const slug = (await admin.get<{ slug: string }>(`/api/workspaces/${s.ws}`)).body.slug;
  const task = await admin.post<Rec>(`/api/projects/${s.project}/tasks`, { data: { sys_title: "Graph: collect IDs", sys_category: s.category, sys_assignees: [s.contributorId] } });
  const hiddenTask = await admin.post<Rec>(`/api/projects/${s.otherProject}/tasks`, { data: { sys_title: "Graph: secret task" } });
  // A wiki page linking to the task and to the hidden task through ordinary links in its content.
  const page = await admin.post<{ id: string }>(`/api/wikis/${s.wiki}/pages`, {
    title: "Graph: onboarding guide",
    content: `<p>See <a href="/w/${slug}/p/${s.project}/t/${task.body.id}">the task</a> and <a href="/w/${slug}/p/${s.otherProject}/t/${hiddenTask.body.id}">that one</a>.</p>`,
  });
  assert.equal(page.status, 201, JSON.stringify(page.body));
  const secretWiki = await contributor.post<{ id: string }>(`/api/workspaces/${s.ws}/wikis`, { name: "Graph secrets", access: "restricted" });
  const secretPage = await contributor.post<{ id: string }>(`/api/wikis/${secretWiki.body.id}/pages`, { title: "Graph: salary bands" });
  await admin.put(`/api/projects/${s.otherProject}/visibility`, { hiddenUserIds: [s.viewerId] });

  const has = (g: G, a: string, b: string, kind: string) => g.links.some((l) => l.kind === kind && ((l.source === a && l.target === b) || (l.source === b && l.target === a)));
  const full = (await admin.get<G>(`/api/workspaces/${s.ws}/graph`)).body;
  const [T, H, W] = [`task:${task.body.id}`, `task:${hiddenTask.body.id}`, `wiki:${page.body.id}`];
  assert.ok(has(full, W, T, "link") && has(full, W, H, "link"), "links written in content become edges");
  assert.ok(has(full, T, `project:${s.project}`, "project") && has(full, T, `tag:${s.category}`, "tag") && has(full, T, `person:${s.contributorId}`, "assignee"));
  assert.ok(has(full, `kr:${s.krLaptop}`, full.nodes.find((n) => n.type === "objective" && has(full, `kr:${s.krLaptop}`, n.id, "okr"))!.id, "okr"), "OKR tree");
  assert.equal(full.nodes.find((n) => n.id === T)!.href, `/w/${slug}/p/${s.project}/t/${task.body.id}`);
  assert.ok(full.nodes.every((n) => n.degree === full.links.filter((l) => l.source === n.id || l.target === n.id).length), "size = number of links");
  assert.ok(full.links.every((l) => full.nodes.some((n) => n.id === l.source) && full.nodes.some((n) => n.id === l.target)));
  assert.ok(full.nodes.some((n) => n.id === `wiki:${secretPage.body.id}`), "workspace admins see every wiki");

  const v = (await viewer.get<G>(`/api/workspaces/${s.ws}/graph`)).body;
  const ids = new Set(v.nodes.map((n) => n.id));
  assert.ok(ids.has(W) && ids.has(T));
  assert.ok(!ids.has(H) && !ids.has(`project:${s.otherProject}`) && !ids.has(`tag:${s.otherCategory}`), "hidden project, its tasks and tags are absent");
  assert.ok(!has(v, W, H, "link"), "a link never reveals a hidden item");
  assert.ok(!ids.has(`wiki:${secretPage.body.id}`), "restricted wiki pages are absent");

  const local = await viewer.get<G>(`/api/workspaces/${s.ws}/graph?focus=${W}&depth=1`);
  assert.equal(local.status, 200);
  assert.equal(local.body.focus, W);
  assert.equal(local.body.nodes.find((n) => n.id === W)!.depth, 0);
  assert.ok(local.body.nodes.some((n) => n.id === T && n.depth === 1));
  assert.ok(local.body.nodes.every((n) => n.depth! <= 1) && !local.body.nodes.some((n) => n.id === `tag:${s.category}`), "depth 1 = direct neighbours only");
  const two = (await viewer.get<G>(`/api/workspaces/${s.ws}/graph?focus=${W}&depth=2`)).body;
  assert.ok(two.nodes.some((n) => n.id === `tag:${s.category}` && n.depth === 2), "the task's tag is two hops away");

  assert.equal((await viewer.get(`/api/workspaces/${s.ws}/graph?focus=wiki:nope`)).status, 400);
  assert.equal((await viewer.get(`/api/workspaces/${s.ws}/graph?depth=5`)).status, 400);
  assert.equal((await outsider.get(`/api/workspaces/${s.ws}/graph`)).status, 404);
  await admin.put(`/api/projects/${s.otherProject}/visibility`, { hiddenUserIds: [] });
});

test("second brain: [[links]], backlinks, block links, tags, related, versions and knowledge metadata", async () => {
  type Conn = { backlinks: { type: string; id: string; context: string; blockId?: string }[]; unlinked: { id: string }[]; outgoing: { target: string; broken: boolean; blockMissing?: boolean }[]; related: { id: string; reasons: string[] }[] };
  const slug = (await admin.get<{ slug: string }>(`/api/workspaces/${s.ws}`)).body.slug;
  const W = s.wiki;
  const a = await admin.post<{ id: string }>(`/api/wikis/${W}/pages`, { title: "Probation policy", content: `<p>Intro.</p><p data-block-id="blk00001">Probation lasts 60 days for new hires.</p><p data-block-id="BAD id">x</p>` });
  assert.equal(a.status, 201);
  const gone = await admin.post<{ id: string }>(`/api/wikis/${W}/pages`, { title: "Temp page" });
  await admin.del(`/api/wiki/${gone.body.id}`);
  const b = await admin.post<{ id: string }>(`/api/wikis/${W}/pages`, {
    title: "Onboarding checklist",
    content: `<p>See <a href="/w/${slug}/wiki/${W}/${a.body.id}#b-blk00001" target="_blank">the probation rule</a> and <a href="/w/${slug}/wiki/${W}/${gone.body.id}">old page</a> and <a href="/w/${slug}/wiki/${W}/${a.body.id}#b-zzzzzz99">a removed block</a>.</p>`,
  });
  const c = await admin.post<{ id: string }>(`/api/wikis/${W}/pages`, { title: "HR FAQ", content: "<p>Read the Probation policy before day one.</p>" });
  s.brainPageA = a.body.id;
  s.brainPageB = b.body.id;

  // Content stays the source of truth: block ids survive sanitizing (invalid ones don't); internal links open in-app.
  const pa = await admin.get<{ content: string; meta: { tags: string[]; version: number; status: string } }>(`/api/wiki/${a.body.id}`);
  assert.match(pa.body.content, /data-block-id="blk00001"/);
  assert.doesNotMatch(pa.body.content, /BAD id/);
  const pb = await admin.get<{ content: string }>(`/api/wiki/${b.body.id}`);
  assert.doesNotMatch(pb.body.content, /target="_blank"[^>]*>the probation/, "internal links carry no target=_blank");
  assert.equal(pa.body.meta.version, 1);
  assert.equal(pa.body.meta.status, "current");

  const conn = (await admin.get<Conn>(`/api/wiki/${a.body.id}/connections`)).body;
  const back = conn.backlinks.find((x) => x.id === b.body.id)!;
  assert.ok(back, "backlink from the page that links here");
  assert.equal(back.blockId, "blk00001", "block-level backlink");
  assert.match(back.context, /the probation rule/, "with the linking sentence");
  assert.ok(conn.unlinked.some((x) => x.id === c.body.id), "unlinked mention of the title");
  const outB = (await admin.get<Conn>(`/api/wiki/${b.body.id}/connections`)).body.outgoing;
  assert.ok(outB.some((o) => o.target === `wiki:${a.body.id}` && !o.broken && !o.blockMissing));
  assert.ok(outB.some((o) => o.target === `wiki:${gone.body.id}` && o.broken), "link to a deleted page is broken");
  assert.ok(outB.some((o) => o.target === `wiki:${a.body.id}` && o.blockMissing), "link to a missing block is flagged");

  // Metadata: tags normalized, validity checked, "still correct" stamps last checked.
  const meta = await admin.patch<{ meta: { tags: string[]; lastCheckedAt: string | null; kind: string } }>(`/api/wiki/${a.body.id}`, { tags: ["#Onboarding", "HR Policy", "onboarding"], kind: "process", markChecked: true, sourceLabel: "Labour Code art. 25", confidence: "high" });
  assert.deepEqual(meta.body.meta.tags, ["onboarding", "hr-policy"]);
  assert.ok(meta.body.meta.lastCheckedAt);
  assert.equal(meta.body.meta.kind, "process");
  assert.equal((await admin.patch(`/api/wiki/${a.body.id}`, { validFrom: "2026-05-01", validTo: "2026-01-01" })).status, 400);
  assert.equal((await viewer.patch(`/api/wiki/${a.body.id}`, { tags: ["x"] })).status, 403, "readers can't change metadata");

  // Related: shares a tag.
  const d = await admin.post<{ id: string }>(`/api/wikis/${W}/pages`, { title: "Buddy program" });
  await admin.patch(`/api/wiki/${d.body.id}`, { tags: ["onboarding"] });
  const rel = (await admin.get<Conn>(`/api/wiki/${a.body.id}/connections`)).body.related;
  assert.ok(rel.find((r) => r.id === d.body.id)?.reasons.includes("#onboarding"));

  // Link picker covers every entity type the viewer can see.
  const picker = await viewer.get<{ items: { type: string; href: string }[] }>(`/api/workspaces/${s.ws}/brain/link-targets?q=Probation`);
  assert.ok(picker.body.items.some((i) => i.type === "wiki" && i.href.endsWith(a.body.id)));

  // A page quoting a project hidden from the viewer never shows up as their backlink.
  const secret = await admin.post<{ id: string }>(`/api/wikis/${W}/pages`, { title: "Other project notes", content: `<p>Other project: see <a href="/w/${slug}/wiki/${W}/${a.body.id}">policy</a></p>` });
  await admin.put(`/api/projects/${s.otherProject}/visibility`, { hiddenUserIds: [s.viewerId] });
  const vb = (await viewer.get<Conn>(`/api/wiki/${a.body.id}/connections`)).body.backlinks;
  assert.ok(vb.some((x) => x.id === b.body.id) && !vb.some((x) => x.id === secret.body.id));
  await admin.put(`/api/projects/${s.otherProject}/visibility`, { hiddenUserIds: [] });

  // Temporal knowledge: a new version supersedes the old one, which stays as history.
  const v2 = await admin.post<{ id: string }>(`/api/wiki/${c.body.id}/new-version`, {});
  assert.equal(v2.status, 201);
  const old = await admin.get<{ meta: { status: string; supersededBy: { id: string } | null; validTo: string | null } }>(`/api/wiki/${c.body.id}`);
  assert.equal(old.body.meta.status, "superseded");
  assert.equal(old.body.meta.supersededBy?.id, v2.body.id);
  const fresh = await admin.get<{ meta: { version: number; supersedes: { id: string } | null } }>(`/api/wiki/${v2.body.id}`);
  assert.equal(fresh.body.meta.version, 2);
  assert.equal(fresh.body.meta.supersedes?.id, c.body.id);
  assert.equal((await admin.post(`/api/wiki/${c.body.id}/new-version`, {})).status, 400, "only one newer version");
  s.brainOldPage = c.body.id;
});

test("second brain: highlight -> task (recurring, OKR), reminder, decisions, graph and search", async () => {
  const A = s.brainPageA;
  // Viewers can't create tasks in the project; contributors can.
  assert.equal((await viewer.post(`/api/wiki/${A}/to-task`, { projectId: s.project, title: "x" })).status, 403);
  const tk = await contributor.post<{ id: string; href: string }>(`/api/wiki/${A}/to-task`, {
    projectId: s.project,
    title: "Run probation review",
    text: "Probation lasts 60 days for new hires.",
    blockId: "blk00001",
    dueDate: "2026-11-02",
    recurrence: { freq: "weekly", interval: 1 },
    okr: `kr:${s.krLaptop}`,
  });
  assert.equal(tk.status, 201, JSON.stringify(tk.body));
  const task = await prisma.task.findUniqueOrThrow({ where: { id: tk.body.id }, include: { assignees: true } });
  assert.equal(task.recurrenceFreq, "weekly");
  assert.equal(task.keyResultId, s.krLaptop);
  assert.deepEqual(task.assignees.map((x) => x.userId), [s.contributorId]);
  assert.match(task.content ?? "", new RegExp(`${A}#b-blk00001`), "task quotes and links back to the block");
  const conn = (await admin.get<{ backlinks: { type: string; id: string; blockId?: string }[] }>(`/api/wiki/${A}/connections`)).body;
  assert.ok(conn.backlinks.some((b) => b.type === "task" && b.id === tk.body.id && b.blockId === "blk00001"), "the task appears in the page's backlinks");

  // Completing a recurring task creates the next occurrence once (a week later).
  let done = await prisma.status.findFirst({ where: { workspaceId: s.ws, category: "done" } });
  done ??= await prisma.status.create({ data: { workspaceId: s.ws, name: "Done", category: "done", color: "#22c55e", sortOrder: 99 } });
  assert.equal((await contributor.patch(`/api/tasks/${tk.body.id}`, { data: { sys_status: done.id } })).status, 200);
  const next = await prisma.task.findFirst({ where: { recurrenceParentId: tk.body.id }, include: { assignees: true } });
  assert.ok(next, "next occurrence created");
  assert.equal(next!.dueDate!.toISOString().slice(0, 10), "2026-11-09");
  assert.equal(next!.keyResultId, s.krLaptop);
  assert.deepEqual(next!.assignees.map((x) => x.userId), [s.contributorId]);
  const todo = await prisma.status.findFirst({ where: { workspaceId: s.ws, category: "todo" } });
  await contributor.patch(`/api/tasks/${tk.body.id}`, { data: { sys_status: todo!.id } });
  await contributor.patch(`/api/tasks/${tk.body.id}`, { data: { sys_status: done.id } });
  assert.equal(await prisma.task.count({ where: { recurrenceParentId: tk.body.id } }), 1, "re-completing doesn't duplicate");
  s.brainTask = tk.body.id;

  // Reminder: hidden until its time, then it is an ordinary notification linking to the block.
  const at = new Date(Date.now() + 3600_000).toISOString();
  const rem = await viewer.post<{ id: string }>(`/api/wiki/${A}/reminder`, { at, text: "Probation lasts 60 days", blockId: "blk00001" });
  assert.equal(rem.status, 201);
  const n = await prisma.notification.findUniqueOrThrow({ where: { id: rem.body.id } });
  assert.equal(n.type, "reminder");
  assert.ok(n.snoozedUntil && n.link?.endsWith(`${A}#b-blk00001`));
  assert.equal((await viewer.post(`/api/wiki/${A}/reminder`, { at: "2020-01-01T00:00:00Z" })).status, 400);

  // Decision memory, with a supersede chain and people involved.
  const d1 = await contributor.post<{ id: string; status: string }>(`/api/workspaces/${s.ws}/decisions`, {
    title: "Probation is 60 days",
    reason: "Aligned with the labour code",
    alternatives: [{ option: "90 days", whyNot: "Too long for junior roles" }],
    evidence: "Legal review",
    projectId: s.project,
    wikiPageId: A,
    sourceBlockId: "blk00001",
    people: [s.contributorId, s.viewerId],
    decidedAt: "2026-09-01",
  });
  assert.equal(d1.status, 201, JSON.stringify(d1.body));
  const d2 = await contributor.post<{ id: string; supersedes: { id: string } | null }>(`/api/workspaces/${s.ws}/decisions`, { title: "Probation is 45 days for interns", supersedesId: d1.body.id, decidedAt: "2026-09-20", projectId: s.project });
  assert.equal(d2.body.supersedes?.id, d1.body.id);
  const d1After = await admin.get<{ status: string; validTo: string; supersededBy: { id: string } | null; alternatives: unknown[]; people: unknown[] }>(`/api/decisions/${d1.body.id}`);
  assert.equal(d1After.body.status, "superseded");
  assert.equal(d1After.body.validTo, "2026-09-19");
  assert.equal(d1After.body.alternatives.length, 1);
  assert.equal(d1After.body.people.length, 2);
  assert.equal((await viewer.post(`/api/workspaces/${s.ws}/decisions`, { title: "x" })).status, 403, "viewers can't record decisions");
  assert.equal((await contributor.post(`/api/workspaces/${s.ws}/decisions`, { title: "x", people: [s.outsiderId] })).status, 400);
  assert.equal((await outsider.get(`/api/decisions/${d1.body.id}`)).status, 404);
  const other = await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/decisions`, { title: "Other project budget", projectId: s.otherProject });
  await admin.put(`/api/projects/${s.otherProject}/visibility`, { hiddenUserIds: [s.viewerId] });
  assert.equal((await viewer.get(`/api/decisions/${other.body.id}`)).status, 404, "decisions of hidden projects are hidden");
  assert.ok(!(await viewer.get<{ id: string }[]>(`/api/workspaces/${s.ws}/decisions`)).body.some((x) => x.id === other.body.id));
  await admin.put(`/api/projects/${s.otherProject}/visibility`, { hiddenUserIds: [] });
  const pageDecisions = (await admin.get<{ backlinks: { type: string; id: string }[] }>(`/api/wiki/${A}/connections`)).body.backlinks.filter((x) => x.type === "decision");
  assert.ok(pageDecisions.some((x) => x.id === d1.body.id), "decisions recorded from a page are its backlinks");
  s.brainDecision = d1.body.id;

  // Graph: decisions and wiki tags are nodes; tags join categories of the same name.
  const g = (await admin.get<{ nodes: { id: string }[]; links: { source: string; target: string; kind: string }[] }>(`/api/workspaces/${s.ws}/graph`)).body;
  assert.ok(g.nodes.some((x) => x.id === `decision:${d1.body.id}`) && g.nodes.some((x) => x.id === "tag:#onboarding"));
  assert.ok(g.links.some((l) => l.kind === "supersedes" && [l.source, l.target].includes(`decision:${d2.body.id}`)));
  assert.ok(g.links.some((l) => [l.source, l.target].includes("tag:#onboarding") && [l.source, l.target].includes(`tag:${s.category}`)), "#onboarding meets the Onboarding category");
  assert.ok(g.links.some((l) => l.kind === "involved" && [l.source, l.target].includes(`person:${s.viewerId}`)));

  // Search: decisions and #tags.
  const found = await admin.get<{ decisions: { id: string }[]; pages: { id: string }[] }>(`/api/search?workspaceId=${s.ws}&q=${encodeURIComponent("Probation is")}`);
  assert.ok(found.body.decisions.some((x) => x.id === d1.body.id));
  const byTag = await admin.get<{ pages: { id: string }[] }>(`/api/search?workspaceId=${s.ws}&q=${encodeURIComponent("#hr-policy")}`);
  assert.deepEqual(byTag.body.pages.map((p) => p.id), [A]);
});

test("second brain: journal, for-you resurfacing, spaced review, weekly review and knowledge health", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const j = await contributor.get<{ completed: { id: string }[]; created: { id: string }[]; decisions: { id: string }[]; notes: string | null }>(`/api/workspaces/${s.ws}/journal?date=${today}&tz=0`);
  assert.ok(j.body.completed.some((x) => x.id === s.brainTask), "work completed today");
  assert.ok(j.body.created.some((x) => x.id === s.brainTask));
  assert.equal((await contributor.put(`/api/workspaces/${s.ws}/journal`, { date: today, notes: "<p>Learned: <script>x</script>check the probation rule</p>" })).status, 200);
  const j2 = await contributor.get<{ notes: string }>(`/api/workspaces/${s.ws}/journal?date=${today}`);
  assert.doesNotMatch(j2.body.notes, /script/);
  assert.equal((await viewer.get<{ notes: string | null }>(`/api/workspaces/${s.ws}/journal?date=${today}`)).body.notes, null, "journals are private");
  await prisma.aiMessage.deleteMany({ where: { conversation: { userId: s.contributorId } } });
  const sum = await contributor.post<{ aiSummary: string }>(`/api/workspaces/${s.ws}/journal/summary`, { date: today, tz: 0 });
  assert.equal(sum.status, 200, JSON.stringify(sum.body));
  const system = (await lastModelRequest()).body.systemInstruction!.parts[0].text;
  assert.match(system, /Run probation review/, "the day's work reaches the summary");

  // For you: the page linked from my open recurring task comes back to me.
  const fy = await contributor.get<{ relatedToWork: { id: string; because: string[] }[]; dueForReview: { id: string }[] }>(`/api/workspaces/${s.ws}/brain/for-you`);
  assert.ok(fy.body.relatedToWork.some((x) => x.id === s.brainPageA && x.because.includes("Run probation review")), JSON.stringify(fy.body.relatedToWork));
  // Spaced review: add -> not due yet; when due it is listed; "done" moves to the next interval.
  const r = await contributor.post<{ stage: number; nextReviewAt: string }>(`/api/wiki/${s.brainPageA}/review`, { action: "add" });
  assert.equal(r.body.stage, 0);
  await prisma.knowledgeReview.updateMany({ where: { userId: s.contributorId, pageId: s.brainPageA }, data: { nextReviewAt: new Date(Date.now() - 1000) } });
  assert.ok((await contributor.get<{ dueForReview: { id: string }[] }>(`/api/workspaces/${s.ws}/brain/for-you`)).body.dueForReview.some((x) => x.id === s.brainPageA));
  const r2 = await contributor.post<{ stage: number; nextReviewAt: string }>(`/api/wiki/${s.brainPageA}/review`, { action: "done" });
  assert.equal(r2.body.stage, 1);
  assert.ok(new Date(r2.body.nextReviewAt).getTime() > Date.now() + 2.9 * 86400000, "next review in 3 days");

  const wk = await contributor.get<{ newKnowledge: { id: string }[]; decisions: { id: string }[]; completed: { id: string }[] }>(`/api/workspaces/${s.ws}/brain/weekly`);
  assert.ok(wk.body.newKnowledge.some((x) => x.id === s.brainPageA) && wk.body.completed.some((x) => x.id === s.brainTask));

  // Knowledge health: broken links, expired validity, duplicates, missing source - suggestions only.
  await admin.patch(`/api/wiki/${s.brainPageB}`, { validFrom: "2025-01-01", validTo: "2025-12-31" });
  const dup = await admin.post<{ id: string }>(`/api/wikis/${s.wiki}/pages`, { title: "Onboarding  checklist" });
  const ai = await admin.post<{ id: string }>(`/api/wikis/${s.wiki}/pages`, { title: "Imported policy" });
  await admin.patch(`/api/wiki/${ai.body.id}`, { sourceType: "imported" });
  const before = await prisma.wikiPage.findUniqueOrThrow({ where: { id: s.brainPageB }, select: { updatedAt: true, status: true } });
  const h = await admin.get<{ issues: { type: string; pageId: string; suggestion: string }[]; counts: Record<string, number> }>(`/api/workspaces/${s.ws}/brain/health`);
  const has = (type: string, pageId: string) => h.body.issues.some((i) => i.type === type && i.pageId === pageId);
  assert.ok(has("broken_link", s.brainPageB), "broken link");
  assert.ok(has("outdated", s.brainPageB), "expired validity");
  assert.ok(has("duplicate", s.brainPageB) || has("duplicate", dup.body.id), "duplicate titles");
  assert.ok(has("missing_source", ai.body.id), "imported without a source");
  const after = await prisma.wikiPage.findUniqueOrThrow({ where: { id: s.brainPageB }, select: { updatedAt: true, status: true } });
  assert.deepEqual(after, before, "health checks never change knowledge");
  const conflicts = await admin.post<{ conflicts: unknown[]; checkedPairs: number }>(`/api/workspaces/${s.ws}/brain/health/conflicts`, {});
  assert.equal(conflicts.status, 200);
  assert.ok(conflicts.body.checkedPairs >= 1);

  // Daily Intelligence: prioritized attention items + a chronological timeline of the day.
  const di = await contributor.get<{ hero: unknown; needsAttention: { kind: string }[]; insights: { kind: string }[]; activity: unknown[]; myTasks: unknown[] }>(`/api/workspaces/${s.ws}/brain/for-you`);
  assert.ok(Array.isArray(di.body.needsAttention) && Array.isArray(di.body.insights) && Array.isArray(di.body.activity));
  const tl = await contributor.get<{ timeline: { type: string; title: string; at: string }[] }>(`/api/workspaces/${s.ws}/journal?date=${today}&tz=0`);
  assert.ok(tl.body.timeline.some((e) => e.type === "completed" && e.title === "Run probation review"), JSON.stringify(tl.body.timeline));
  assert.deepEqual([...tl.body.timeline].map((e) => e.at), [...tl.body.timeline].map((e) => e.at).sort(), "the timeline is chronological");
  const insights = await contributor.post<{ insights: { title: string; action: string }[] }>(`/api/workspaces/${s.ws}/brain/insights`, {});
  assert.equal(insights.status, 200, JSON.stringify(insights.body));
  assert.ok(insights.body.insights.length >= 1);

  // Structured decisions: owner (must be a member) and review date; due reviews resurface.
  const dec = await contributor.post<{ id: string; owner: { id: string } | null; reviewDue: boolean }>(`/api/workspaces/${s.ws}/decisions`, { title: "Review the intern stipend", reviewDate: "2026-01-01", ownerId: s.contributorId });
  assert.equal(dec.status, 201, JSON.stringify(dec.body));
  assert.equal(dec.body.owner?.id, s.contributorId);
  assert.equal(dec.body.reviewDue, true);
  assert.equal((await contributor.post(`/api/workspaces/${s.ws}/decisions`, { title: "x", ownerId: s.outsiderId })).status, 400, "owners are members");
  const due = await contributor.get<{ id: string }[]>(`/api/workspaces/${s.ws}/decisions?review=due`);
  assert.ok(due.body.some((d) => d.id === dec.body.id));
  const defOwner = await contributor.post<{ owner: { id: string } | null }>(`/api/workspaces/${s.ws}/decisions`, { title: "Default owner is the author" });
  assert.equal(defOwner.body.owner?.id, s.contributorId);
  const fy2 = await contributor.get<{ needsAttention: { kind: string; id: string }[] }>(`/api/workspaces/${s.ws}/brain/for-you`);
  assert.ok(fy2.body.needsAttention.some((a) => a.kind === "decision_review" && a.id === dec.body.id), JSON.stringify(fy2.body.needsAttention));

  // Weekly reflection: structured sections, not a wall of text.
  const refl = await contributor.post<{ reflection: { headline: string; wins: string[]; nextWeek: string[] }; markdown: string }>(`/api/workspaces/${s.ws}/brain/weekly/summary`, {});
  assert.equal(refl.status, 200, JSON.stringify(refl.body));
  assert.ok(refl.body.reflection.headline && Array.isArray(refl.body.reflection.wins));
  assert.match(refl.body.markdown, /Open loops|Việc còn dang dở/);
});

test("second brain: Ask My Brain is scoped, grounded and traceable; layers and retrospectives stay drafts", async () => {
  type Ask = { answer: string; sources: { n: number; type: string; id: string; used: boolean; historical?: boolean }[]; conversationId: string; grounded: boolean };
  await prisma.aiMessage.deleteMany({ where: { conversation: { userId: { in: [s.viewerId, s.contributorId] } } } });
  const r = await contributor.post<Ask>(`/api/workspaces/${s.ws}/brain/ask`, { question: "How long is probation?", scope: { type: "everything" } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.grounded && r.body.sources[0].used, "the cited source is marked");
  assert.ok(r.body.sources.some((x) => x.id === s.brainPageA), "the probation page is a source");
  assert.ok(r.body.sources.some((x) => x.type === "decision" && x.id === s.brainDecision && x.historical), "superseded decisions are flagged as history");
  const system = (await lastModelRequest()).body.systemInstruction!.parts[0].text;
  assert.match(system, /\[S1\] [A-Z]+:/);
  assert.match(system, /Cite every factual statement/);
  const saved = await prisma.aiMessage.findFirst({ where: { conversationId: r.body.conversationId, role: "model" } });
  assert.ok(Array.isArray(saved?.sources) && (saved!.sources as { used: boolean }[]).some((x) => x.used), "sources are stored with the answer");
  const hist = await contributor.get<{ messages: { sources: unknown }[] }>(`/api/workspaces/${s.ws}/brain/ask?conversationId=${r.body.conversationId}`);
  assert.ok(hist.body.messages[1].sources);

  // Selected sources: exactly those; other people's conversations are private.
  const sel = await contributor.post<Ask>(`/api/workspaces/${s.ws}/brain/ask`, { question: "summarize", scope: { type: "sources", sources: [`task:${s.brainTask}`] } });
  assert.deepEqual(sel.body.sources.map((x) => x.id), [s.brainTask]);
  assert.equal((await viewer.get(`/api/workspaces/${s.ws}/brain/ask?conversationId=${r.body.conversationId}`)).status, 404);
  // A hidden project's pages never become sources, even when asked for directly.
  const secret = await admin.post<{ id: string }>(`/api/wikis/${s.wiki}/pages`, { title: "Other project probation exception", content: "<p>Other project: probation 30 days.</p>" });
  await admin.put(`/api/projects/${s.otherProject}/visibility`, { hiddenUserIds: [s.viewerId] });
  const v = await viewer.post<Ask>(`/api/workspaces/${s.ws}/brain/ask`, { question: "probation exception", scope: { type: "sources", sources: [`wiki:${secret.body.id}`, `wiki:${s.brainPageA}`] } });
  assert.deepEqual(v.body.sources.map((x) => x.id), [s.brainPageA]);
  const v2 = await viewer.post<Ask>(`/api/workspaces/${s.ws}/brain/ask`, { question: "probation exception", scope: { type: "everything" } });
  assert.ok(!v2.body.sources.some((x) => x.id === secret.body.id));
  await admin.put(`/api/projects/${s.otherProject}/visibility`, { hiddenUserIds: [] });
  assert.equal((await viewer.post(`/api/workspaces/${s.ws}/brain/ask`, { question: "x", scope: { type: "project", projectId: s.otherProject } })).status, 200);
  const mine = await viewer.post<Ask>(`/api/workspaces/${s.ws}/brain/ask`, { question: "probation", scope: { type: "mine" } });
  assert.ok(!mine.body.sources.some((x) => x.id === s.brainPageA), "My notes only = pages I wrote and my journal");

  // Wiki assistant labels superseded knowledge as history.
  assert.equal((await ask(contributor, { kind: "wiki", wikiId: s.wiki, message: "faq?" })).status, 200);
  assert.match((await lastModelRequest()).body.systemInstruction!.parts[0].text, /HR FAQ[^\n]*HISTORICAL - not current/);

  // Progressive summarization: highlights + AI draft; the page content never changes.
  const contentBefore = (await prisma.wikiPage.findUniqueOrThrow({ where: { id: s.brainPageA } })).content;
  const hl = await admin.put<{ highlights: { text: string; blockId?: string }[] }>(`/api/wiki/${s.brainPageA}/layers`, { addHighlight: { text: "Probation lasts 60 days", blockId: "blk00001" } });
  assert.equal(hl.body.highlights[0].blockId, "blk00001");
  const draft = await admin.post<{ keyPoints: string; summary: string; generatedFrom: string }>(`/api/wiki/${s.brainPageA}/layers/generate`, {});
  assert.equal(draft.status, 200, JSON.stringify(draft.body));
  assert.match(draft.body.keyPoints, /Probation is 60 days/);
  assert.equal((await prisma.knowledgeLayer.findUnique({ where: { pageId: s.brainPageA } }))?.summary ?? null, null, "the draft is not saved by itself");
  const savedLayers = await admin.put<{ summary: string; stale: boolean }>(`/api/wiki/${s.brainPageA}/layers`, { summary: draft.body.summary, keyPoints: draft.body.keyPoints, generatedFrom: draft.body.generatedFrom });
  assert.equal(savedLayers.body.summary, "Onboarding summary.");
  assert.equal(savedLayers.body.stale, false);
  assert.equal((await prisma.wikiPage.findUniqueOrThrow({ where: { id: s.brainPageA } })).content, contentBefore, "source untouched");
  assert.equal((await viewer.put(`/api/wiki/${s.brainPageA}/layers`, { summary: "x" })).status, 403);

  // Retrospective of a finished task: a draft, saved as an AI-generated draft page + proposed decisions.
  const retro = await contributor.post<{ draft: { title: string; decisions: unknown[] }; source: string }>(`/api/brain/retro`, { taskId: s.brainTask });
  assert.equal(retro.status, 200, JSON.stringify(retro.body));
  assert.equal(retro.body.draft.decisions.length, 1);
  const retroSystem = (await lastModelRequest()).body.systemInstruction!.parts[0].text;
  assert.match(retroSystem, /HISTORY \(status, dates and field changes\)/);
  const next = await prisma.task.findFirstOrThrow({ where: { recurrenceParentId: s.brainTask } });
  assert.equal((await contributor.post(`/api/brain/retro`, { taskId: next.id })).status, 400, "only finished tasks");
  const savedRetro = await contributor.post<{ pageId: string; decisionIds: string[] }>(`/api/brain/retro/save`, { wikiId: s.wiki, source: retro.body.source, draft: retro.body.draft, saveDecisions: [0] });
  assert.equal(savedRetro.status, 201, JSON.stringify(savedRetro.body));
  const rp = await prisma.wikiPage.findUniqueOrThrow({ where: { id: savedRetro.body.pageId } });
  assert.equal(rp.kind, "retrospective");
  assert.equal(rp.status, "draft");
  assert.equal(rp.sourceType, "ai_generated");
  assert.equal(rp.sourceRef, `task:${s.brainTask}`);
  const rd = await prisma.decision.findUniqueOrThrow({ where: { id: savedRetro.body.decisionIds[0] } });
  assert.equal(rd.status, "proposed");
  assert.equal(rd.wikiPageId, rp.id);
});

test("recognition: points from real activity, leaderboards, supporters, visibility and delegation", async () => {
  type Board = { rows: { rank: number; user: { id: string }; value: number; detail?: Record<string, number> }[]; me: { rank: number } | null; total: number };
  // Settings exist with defaults; points are materialized from what already happened.
  const o = await contributor.get<{ points: { earned: number; balance: number }; canManage: boolean; canSeeOthersPoints: boolean }>(`/api/workspaces/${s.ws}/recognition`);
  assert.equal(o.status, 200, JSON.stringify(o.body));
  assert.ok(o.body.points.earned > 0, "earlier completed tasks / comments earned points");
  assert.equal(o.body.canManage, false);
  const ev = await prisma.pointEvent.findMany({ where: { workspaceId: s.ws, userId: s.contributorId, action: "task_completed" } });
  assert.ok(ev.some((e) => e.sourceId === s.brainTask && e.points === 10), "task completed = 10 pts (default rule)");
  const before = await prisma.pointEvent.count({ where: { workspaceId: s.ws } });
  await contributor.get(`/api/workspaces/${s.ws}/recognition`);
  assert.equal(await prisma.pointEvent.count({ where: { workspaceId: s.ws } }), before, "syncing again adds nothing (idempotent)");

  // Leaderboards: metric x period x top N.
  const year = await contributor.get<Board>(`/api/workspaces/${s.ws}/recognition/leaderboard?metric=tasks&period=year&top=1`);
  assert.equal(year.status, 200);
  assert.ok(year.body.rows.length <= 1);
  const today = new Date().toISOString().slice(0, 10);
  const custom = await contributor.get<Board>(`/api/workspaces/${s.ws}/recognition/leaderboard?metric=points&period=custom&from=2020-01-01&to=${today}&top=50`);
  assert.ok(custom.body.rows.some((r) => r.user.id === s.contributorId && r.value > 0));
  assert.ok(custom.body.me);
  assert.equal((await contributor.get(`/api/workspaces/${s.ws}/recognition/leaderboard?metric=bogus`)).status, 400);
  assert.equal((await contributor.get(`/api/workspaces/${s.ws}/recognition/leaderboard?period=custom&from=2026-05-01&to=2026-01-01`)).status, 400);
  assert.equal((await outsider.get(`/api/workspaces/${s.ws}/recognition/leaderboard`)).status, 404);

  // Supporters: someone commenting on my task shows up as supporting me.
  assert.equal((await viewer.post(`/api/tasks/${s.task1}/comments`, { body: "Here's the vendor contact for the laptop" })).status, 201);
  const sup = await contributor.get<Board>(`/api/workspaces/${s.ws}/recognition/supporters?period=month&top=5`);
  const v = sup.body.rows.find((r) => r.user.id === s.viewerId);
  assert.ok(v && (v.detail?.comments ?? 0) >= 1, JSON.stringify(sup.body));

  // Only admins / delegated managers change the rules; only admins delegate.
  assert.equal((await contributor.get(`/api/workspaces/${s.ws}/recognition/settings`)).status, 403);
  assert.equal((await contributor.put(`/api/workspaces/${s.ws}/recognition/managers`, { userIds: [s.contributorId] })).status, 403);
  assert.equal((await admin.put(`/api/workspaces/${s.ws}/recognition/managers`, { userIds: [s.contributorId] })).status, 200);
  const st = await contributor.get<{ rules: { action: string; points: number }[]; canDelegate: boolean }>(`/api/workspaces/${s.ws}/recognition/settings`);
  assert.equal(st.status, 200);
  assert.equal(st.body.canDelegate, false, "delegated managers can't delegate further");
  assert.equal((await contributor.put(`/api/workspaces/${s.ws}/recognition/settings`, { rules: [{ action: "comment_posted", points: 2, enabled: true }], membersSeePoints: false })).status, 200);

  // Visibility: points boards hidden from members by default now; per-person override.
  assert.equal((await viewer.get(`/api/workspaces/${s.ws}/recognition/leaderboard?metric=points`)).status, 403);
  assert.equal((await viewer.get(`/api/workspaces/${s.ws}/recognition/leaderboard?metric=tasks`)).status, 200, "task boards stay visible");
  assert.equal((await viewer.get(`/api/workspaces/${s.ws}/recognition/history?userId=${s.contributorId}`)).status, 403);
  assert.equal((await viewer.get(`/api/workspaces/${s.ws}/recognition/history`)).status, 200, "own points always visible");
  assert.equal((await contributor.put(`/api/workspaces/${s.ws}/recognition/members/${s.viewerId}`, { canViewOthersPoints: true })).status, 200);
  assert.equal((await viewer.get(`/api/workspaces/${s.ws}/recognition/leaderboard?metric=points`)).status, 200);
});

test("recognition: thank-you letters notify, open, stay private when asked, and can't be farmed", async () => {
  type K = { id: string; href: string; read: boolean; isPublic: boolean };
  assert.equal((await viewer.post(`/api/workspaces/${s.ws}/kudos`, { toId: s.viewerId, title: "Me", message: "Thanks to myself for everything" })).status, 400, "not to yourself");
  assert.equal((await viewer.post(`/api/workspaces/${s.ws}/kudos`, { toId: s.outsiderId, title: "Hi", message: "Thanks for all your help!" })).status, 400, "only members");
  const k = await viewer.post<K>(`/api/workspaces/${s.ws}/kudos`, { toId: s.contributorId, style: "gratitude", title: "Thank you for the laptop", message: "You set everything up before day one. It made the new hire feel welcome.", reason: "preparing the laptop", taskId: s.task1, values: ["teamwork"] });
  assert.equal(k.status, 201, JSON.stringify(k.body));
  const n = await prisma.notification.findFirst({ where: { userId: s.contributorId, type: "kudos" }, orderBy: { createdAt: "desc" } });
  assert.ok(n && n.link?.endsWith(`/recognition/kudos/${k.body.id}`) && n.actorId === s.viewerId, "the receiver is notified (pop-up)");
  const opened = await contributor.get<K>(`/api/kudos/${k.body.id}`);
  assert.equal(opened.status, 200);
  assert.ok((await prisma.kudos.findUniqueOrThrow({ where: { id: k.body.id } })).readAt, "opening marks it read");
  assert.ok((await prisma.notification.findUniqueOrThrow({ where: { id: n!.id } })).readAt);
  // Points: the receiver earns once per sender per day.
  const pts = () => prisma.pointEvent.count({ where: { workspaceId: s.ws, userId: s.contributorId, action: "kudos_received" } });
  const once = await pts();
  assert.ok(once >= 1);
  await viewer.post(`/api/workspaces/${s.ws}/kudos`, { toId: s.contributorId, title: "Again", message: "And thanks again for the follow-up!" });
  await contributor.get(`/api/workspaces/${s.ws}/recognition`);
  assert.equal(await pts(), once, "a second letter the same day earns no extra points");

  // Private letters: only sender and receiver; lists per scope.
  const priv = await admin.post<K>(`/api/workspaces/${s.ws}/kudos`, { toId: s.contributorId, title: "Just between us", message: "Thank you for covering for me this week.", isPublic: false });
  assert.equal((await viewer.get(`/api/kudos/${priv.body.id}`)).status, 404);
  const wall = await viewer.get<{ items: { id: string }[] }>(`/api/workspaces/${s.ws}/kudos?scope=wall`);
  assert.ok(wall.body.items.some((x) => x.id === k.body.id) && !wall.body.items.some((x) => x.id === priv.body.id));
  const mine = await contributor.get<{ items: { id: string }[] }>(`/api/workspaces/${s.ws}/kudos?scope=received`);
  assert.ok(mine.body.items.some((x) => x.id === priv.body.id), "the receiver keeps every letter");
  assert.equal((await contributor.del(`/api/kudos/${k.body.id}`)).status, 403, "only the sender can withdraw");

  // AI helps write the letter (draft only).
  const draft = await viewer.post<{ title: string; message: string }>(`/api/workspaces/${s.ws}/kudos/draft`, { toId: s.contributorId, reason: "fixed the payroll export", style: "appreciation" });
  assert.equal(draft.status, 200, JSON.stringify(draft.body));
  assert.ok(draft.body.title && draft.body.message.length > 20, "a draft letter comes back");
  assert.match((await lastModelRequest()).body.systemInstruction!.parts[0].text, /fixed the payroll export/);

  // Card designs, an editable greeting/closing, and Vietnamese typed with decomposed accents is stored as NFC.
  const nfd = "Cảm ơn bạn rất nhiều vì đã hỗ trợ".normalize("NFD");
  const card = await viewer.post<{ id: string; template: string; greeting: string; closing: string; message: string }>(`/api/workspaces/${s.ws}/kudos`, { toId: s.contributorId, template: "botanical", greeting: "Chào Linh thân mến,", closing: "Thương mến,\n— Team HR", title: "Cảm ơn", message: nfd });
  assert.equal(card.status, 201, JSON.stringify(card.body));
  assert.equal(card.body.template, "botanical");
  assert.equal(card.body.greeting, "Chào Linh thân mến,");
  assert.equal(card.body.message, nfd.normalize("NFC"), "accents are composed (NFC) so fonts render them");
  assert.equal((await viewer.post(`/api/workspaces/${s.ws}/kudos`, { toId: s.contributorId, template: "nope", title: "x", message: "Thanks for everything!" })).status, 400);
  // AI suggestions grounded in shared history; the reason is optional.
  const ctx = await viewer.get<{ facts: { kind: string; n: number }[] }>(`/api/workspaces/${s.ws}/kudos/context?toId=${s.contributorId}`);
  assert.equal(ctx.status, 200);
  assert.ok(Array.isArray(ctx.body.facts));
  const noReason = await viewer.post<{ message: string; reasons: string[] }>(`/api/workspaces/${s.ws}/kudos/draft`, { toId: s.contributorId, style: "teamwork" });
  assert.equal(noReason.status, 200, JSON.stringify(noReason.body));
  assert.ok(noReason.body.reasons.length >= 1, "AI proposes reasons to thank them");
  assert.match((await lastModelRequest()).body.systemInstruction!.parts[0].text, /OUR WORK TOGETHER/);
  assert.equal((await viewer.get(`/api/workspaces/${s.ws}/kudos/context?toId=${s.outsiderId}`)).status, 400, "only members");
});

test("recognition: reward catalog, redemption with reserved points, approval and stock limits, reachable-reward alerts", async () => {
  type R = { id: string; remaining: number; soldOut: boolean };
  assert.equal((await viewer.post(`/api/workspaces/${s.ws}/rewards`, { name: "Nope", pointsCost: 1, quantity: 1 })).status, 403);
  const bal = async (c: Client) => (await c.get<{ points: { balance: number } }>(`/api/workspaces/${s.ws}/recognition`)).body.points.balance;
  const cBal = await bal(contributor);
  const aBal = await bal(admin);
  const cheapCost = Math.max(1, Math.min(cBal, aBal));
  // Delegated manager adds several rewards at once.
  const created = await contributor.post<R[]>(`/api/workspaces/${s.ws}/rewards`, { items: [{ name: "Coffee voucher", pointsCost: cheapCost, price: 50000, currency: "VND", quantity: 1 }, { name: "Extra day off", pointsCost: 1_000_000, quantity: 5 }] });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const [coffee, dayOff] = created.body;
  // Anyone whose balance covers it gets a reachable-reward notice (once).
  const alert = await prisma.notification.findFirst({ where: { userId: s.contributorId, dedupeKey: `reward-reachable:${coffee.id}` } });
  assert.ok(alert && (alert.data as { kind: string }).kind === "reward_reachable");
  assert.ok(!(await prisma.notification.findFirst({ where: { dedupeKey: `reward-reachable:${dayOff.id}` } })), "not for rewards nobody can afford");
  // Picture upload (PNG magic bytes).
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const form = new FormData();
  form.append("file", new Blob([png], { type: "image/png" }), "c.png");
  const up = await fetch(`${BASE}/api/rewards/${coffee.id}/image`, { method: "PUT", headers: { cookie: contributor.cookieHeader() }, body: form });
  assert.equal(up.status, 200);
  assert.ok((await viewer.get<R[]>(`/api/workspaces/${s.ws}/rewards`)).body.find((x) => x.id === dayOff.id), "members see the catalog");
  const form2 = new FormData();
  form2.append("file", new Blob([png], { type: "image/png" }), "d.png");
  await fetch(`${BASE}/api/rewards/${dayOff.id}/image`, { method: "PUT", headers: { cookie: contributor.cookieHeader() }, body: form2 });
  assert.equal((await viewer.del(`/api/rewards/${dayOff.id}/image`)).status, 403, "members can't remove pictures");
  assert.equal((await contributor.del(`/api/rewards/${dayOff.id}/image`)).status, 204);
  assert.equal((await viewer.get<{ id: string; imageUrl: string | null }[]>(`/api/workspaces/${s.ws}/rewards`)).body.find((x) => x.id === dayOff.id)?.imageUrl, null);
  // Edit in place.
  const edited = await contributor.patch<{ name: string; description: string; price: number }>(`/api/rewards/${dayOff.id}`, { name: "Extra day off (1 day)", description: "Book it with your manager", price: 1500000 });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.price, 1500000);

  assert.equal((await contributor.post(`/api/rewards/${dayOff.id}/redeem`, {})).status, 400, "not enough points");
  const r1 = await contributor.post<{ id: string; status: string }>(`/api/rewards/${coffee.id}/redeem`, { note: "Thanks!" });
  assert.equal(r1.status, 201, JSON.stringify(r1.body));
  assert.ok((await contributor.get<{ pendingRequests: number }>(`/api/workspaces/${s.ws}/recognition`)).body.pendingRequests >= 1, "managers see how many requests wait");
  assert.equal((await viewer.get<{ pendingRequests: number }>(`/api/workspaces/${s.ws}/recognition`)).body.pendingRequests, 0);
  assert.equal(await bal(contributor), cBal - cheapCost, "points are reserved while pending");
  const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
  assert.ok(await prisma.notification.findFirst({ where: { userId: adminUser.id, type: "reward_request", actorId: s.contributorId } }), "approvers are told about the request");
  const r2 = await admin.post<{ id: string }>(`/api/rewards/${coffee.id}/redeem`, {});
  assert.equal(r2.status, 201);
  assert.equal((await viewer.patch(`/api/redemptions/${r1.body.id}`, { action: "approve" })).status, 403, "members can't approve");
  assert.equal((await contributor.patch(`/api/redemptions/${r1.body.id}`, { action: "approve" })).status, 200);
  const out = await contributor.patch<{ error: string }>(`/api/redemptions/${r2.body.id}`, { action: "approve" });
  assert.equal(out.status, 400);
  assert.match(out.body.error, /out of stock/i, "stock is never exceeded");
  assert.equal((await contributor.patch(`/api/redemptions/${r2.body.id}`, { action: "reject", note: "Sold out" })).status, 200);
  assert.equal(await bal(admin), aBal, "rejected points are released");
  const list = await viewer.get<R[]>(`/api/workspaces/${s.ws}/rewards`);
  assert.ok(list.body.find((x) => x.id === coffee.id)?.soldOut);
  assert.equal((await admin.post(`/api/rewards/${coffee.id}/redeem`, {})).status, 400, "sold out");
  const res = await prisma.notification.findFirst({ where: { userId: s.contributorId, type: "reward_result" } });
  assert.equal((res?.data as { decision: string }).decision, "approved");
  assert.equal((await contributor.patch(`/api/rewards/${coffee.id}`, { quantity: 0 })).status, 400, "stock can't drop below what was given");
  assert.equal(await prisma.$queryRaw<{ n: number }[]>`SELECT approved_count AS n FROM rewards WHERE id = ${coffee.id}::uuid`.then((x) => Number(x[0].n)), 1);

  // Recalculate with the current rules keeps reservations intact.
  assert.equal((await contributor.post(`/api/workspaces/${s.ws}/recognition/recalculate`, {})).status, 200);
  assert.equal(await bal(contributor) <= cBal, true);
  await admin.put(`/api/workspaces/${s.ws}/recognition/managers`, { userIds: [] });
  assert.equal((await contributor.get(`/api/workspaces/${s.ws}/recognition/settings`)).status, 403, "delegation revoked");
});

test("notification settings: per-group pop-up / device switches and a ringtone, validated", async () => {
  const def = await viewer.get<{ popupOff: string[]; nativeOff: string[]; sound: string; volume: number }>("/api/account/notification-settings");
  assert.equal(def.status, 200);
  assert.deepEqual(def.body, { popupOff: [], nativeOff: [], sound: "chime", volume: 70 });
  const put = await viewer.put<{ popupOff: string[]; nativeOff: string[]; sound: string; volume: number }>("/api/account/notification-settings", { popupOff: ["updates", "updates", "ai"], nativeOff: ["comment"], sound: "marimba", volume: 40 });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.deepEqual(put.body.popupOff.sort(), ["ai", "updates"], "de-duplicated");
  assert.equal(put.body.sound, "marimba");
  assert.equal((await viewer.put("/api/account/notification-settings", { popupOff: ["nope"] })).status, 400);
  assert.equal((await viewer.put("/api/account/notification-settings", { sound: "siren" })).status, 400);
  assert.equal((await viewer.put("/api/account/notification-settings", { volume: 101 })).status, 400);
  assert.equal((await contributor.get<{ sound: string }>("/api/account/notification-settings")).body.sound, "chime", "settings are personal");
  // Notifications carry the actor, so the Action center can show their profile picture.
  const n = await contributor.get<{ items: { actor: { id: string } | null; workspaceId: string | null }[] }>("/api/notifications");
  assert.ok(n.body.items.some((x) => x.actor?.id && x.workspaceId));
});

test("invite links and invitations for people without an account: accept, decline, revoke, replace", async () => {
  const ws = await admin.post<{ id: string }>("/api/workspaces", { name: "Invite Co" });
  // Join link: off by default; admins turn it on and pick the role.
  assert.equal((await admin.get<{ enabled: boolean }>(`/api/workspaces/${ws.body.id}/invite-link`)).body.enabled, false);
  assert.equal((await admin.post(`/api/workspaces/${ws.body.id}/invite-link`, { role: "admin" })).status, 400, "links never grant admin");
  const on = await admin.post<{ enabled: boolean; url: string; role: string }>(`/api/workspaces/${ws.body.id}/invite-link`, { role: "viewer" });
  assert.equal(on.body.enabled, true);
  const token = on.body.url.split("/invite/")[1];
  assert.equal((await outsider.get<{ kind: string; state: string }>(`/api/invite/${token}`)).body.kind, "link");
  assert.equal(await prisma.workspaceMember.count({ where: { workspaceId: ws.body.id, userId: s.outsiderId } }), 0, "opening the link joins nobody");
  assert.equal((await outsider.post(`/api/invite/${token}`, { decision: "accept" })).status, 200);
  assert.equal((await prisma.workspaceMember.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: ws.body.id, userId: s.outsiderId } } })).role, "viewer");
  assert.equal((await admin.get<{ uses: number }>(`/api/workspaces/${ws.body.id}/invite-link`)).body.uses, 1);
  // Replacing the link kills the old one; turning it off kills it too.
  const fresh = await admin.post<{ url: string }>(`/api/workspaces/${ws.body.id}/invite-link`, { regenerate: true });
  assert.notEqual(fresh.body.url, on.body.url);
  assert.equal((await contributor.get<{ state: string }>(`/api/invite/${token}`)).body.state, "revoked");
  assert.equal((await contributor.post(`/api/invite/${token}`, { decision: "accept" })).status, 400);
  await admin.del(`/api/workspaces/${ws.body.id}/invite-link`);
  assert.equal((await contributor.post(`/api/invite/${fresh.body.url.split("/invite/")[1]}`, { decision: "accept" })).status, 400);
  assert.equal((await contributor.get(`/api/workspaces/${ws.body.id}/invite-link`)).status, 404, "non-members can't manage it");

  // Invite someone with no account: they see it right after signing up with that email.
  const r = await admin.post<{ invitations: { hasAccount: boolean; url: string }[] }>(`/api/workspaces/${ws.body.id}/members`, { email: "newbie@integration.test", role: "editor" });
  assert.equal(r.body.invitations[0].hasAccount, false);
  const newbie = new Client();
  assert.equal((await newbie.post("/api/register", { email: "newbie@integration.test", password: "Newbie1234", name: "Nina New" })).status, 201);
  assert.ok(await newbie.login("newbie@integration.test", "Newbie1234"));
  assert.deepEqual((await newbie.get<unknown[]>("/api/invitations")).body, [], "nothing until the address is verified");
  const nb = await prisma.user.findUniqueOrThrow({ where: { email: "newbie@integration.test" } });
  assert.equal((await admin.patch(`/api/admin/users/${nb.id}`, { verifyEmail: true })).status, 200);
  const mine = await newbie.get<{ workspaceName: string; token: string }[]>("/api/invitations");
  assert.deepEqual(mine.body.map((x) => x.workspaceName), ["Invite Co"]);
  assert.ok((await newbie.get<{ items: { type: string }[] }>("/api/notifications")).body.items.some((n) => n.type === "workspace_invite"), "and in the Action Center");
  // Declining: no membership, the inviter is told, the link is spent.
  assert.equal((await newbie.post<{ joined: boolean }>(`/api/invite/${mine.body[0].token}`, { decision: "decline" })).body.joined, false);
  assert.equal(await prisma.workspaceMember.count({ where: { workspaceId: ws.body.id, user: { email: "newbie@integration.test" } } }), 0);
  assert.equal((await newbie.post(`/api/invite/${mine.body[0].token}`, { decision: "accept" })).status, 400);
  assert.equal((await newbie.get<unknown[]>("/api/invitations")).body.length, 0);

  // Revoking a pending invitation.
  const rv = await admin.post<{ invitations: { invitationId?: string; url: string }[] }>(`/api/workspaces/${ws.body.id}/members`, { email: "viewer@integration.test", role: "viewer" });
  const pending = await admin.get<{ id: string }[]>(`/api/workspaces/${ws.body.id}/invitations`);
  assert.equal(pending.body.length, 1);
  assert.equal((await viewer.del(`/api/invitations/${pending.body[0].id}`)).status, 404, "only the workspace's admins");
  assert.equal((await admin.del(`/api/invitations/${pending.body[0].id}`)).status, 204);
  assert.equal((await viewer.post(`/api/invite/${rv.body.invitations[0].url.split("/invite/")[1]}`, { decision: "accept" })).status, 400);
  assert.ok(!(await viewer.get<{ items: { type: string; actioned: boolean; title: string }[] }>("/api/notifications?view=todo")).body.items.some((n) => n.type === "workspace_invite" && n.title === "Invite Co"), "leaves their To do");
});

test("members can leave; only owners delete a workspace", async () => {
  const invited = await contributor.post<{ invitations: { url: string }[] }>(`/api/workspaces/${s.contributorWs}/members`, { email: "viewer@integration.test", role: "admin" });
  assert.equal(invited.status, 201);
  assert.equal((await viewer.post(`/api/invite/${invited.body.invitations[0].url.split("/invite/")[1]}`, { decision: "accept" })).status, 200);
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

test("security: stolen sessions die on reset, sign-in is throttled, public forms don't expose people, viewers can't log time", async () => {
  // Session revocation: an admin password reset kills every existing cookie of that account.
  const before = await outsider.get("/api/workspaces");
  assert.equal(before.status, 200);
  const reset = await admin.patch<{ temporaryPassword: string }>(`/api/admin/users/${s.outsiderId}`, { resetPassword: true });
  assert.equal(reset.status, 200);
  assert.equal((await outsider.get("/api/workspaces")).status, 401, "the old cookie no longer works");
  assert.ok(await outsider.login("outsider@integration.test", reset.body.temporaryPassword));
  assert.equal((await outsider.post("/api/account/password", { currentPassword: reset.body.temporaryPassword, newPassword: "Outsider456" })).status, 200);

  // Sign-in throttling is per account and shared by all instances (database counters).
  const victim = new Client();
  assert.equal((await victim.post("/api/register", { email: "throttle@integration.test", password: "Throttle123", name: "Throttle" })).status, 201);
  for (let i = 0; i < 10; i++) assert.equal(await victim.login("throttle@integration.test", `wrong-${i}`), false);
  assert.equal(await victim.login("throttle@integration.test", "Throttle123"), false, "even the right password waits once the account is throttled");
  assert.ok(await prisma.activityLog.findFirst({ where: { action: "sign_in_throttled" } }), "throttling is audit-logged");
  assert.ok(await prisma.activityLog.findFirst({ where: { action: "sign_in_failed", ip: { not: null } } }), "failed sign-ins carry the client address");
  await prisma.rateLimit.deleteMany({ where: { key: { startsWith: "login-" } } });
  assert.ok(await victim.login("throttle@integration.test", "Throttle123"));

  // Public forms: no people fields, no staff list, anonymous submissions rate limited.
  const view = await prisma.view.create({ data: { projectId: s.project, name: "Public intake", type: "form", isPublic: true, config: {} } });
  const anon = new Client();
  const form = await anon.get<{ fields: { id: string; type: string }[]; members: unknown[] }>(`/api/public/forms/${view.id}`);
  assert.equal(form.status, 200);
  assert.deepEqual(form.body.members, [], "the member list is never published");
  assert.ok(form.body.fields.length > 0 && !form.body.fields.some((f) => f.type === "person" || f.type === "people"), "people fields are not offered anonymously");
  const sub = await anon.post(`/api/public/forms/${view.id}`, { data: { sys_title: "From the internet", sys_assignees: [s.contributorId] } });
  assert.equal(sub.status, 201);
  const created = await prisma.task.findFirstOrThrow({ where: { title: "From the internet" }, include: { assignees: true } });
  assert.equal(created.assignees.length, 0, "strangers can't assign (and notify) staff");
  let limited = 0;
  for (let i = 0; i < 12; i++) if ((await anon.post(`/api/public/forms/${view.id}`, { data: { sys_title: `Spam ${i}` } })).status === 429) limited++;
  assert.ok(limited >= 2, "anonymous submissions are rate limited");

  // Focus: a viewer may keep a personal focus record but can't add time to someone's task.
  const t = await prisma.task.findFirstOrThrow({ where: { projectId: s.project, deletedAt: null }, select: { id: true, actualMinutes: true } });
  const f = await viewer.post<{ id: string }>(`/api/tasks/${t.id}/focus`, {});
  assert.equal(f.status, 201);
  await prisma.focusSession.update({ where: { id: f.body.id }, data: { elapsedSeconds: 600, resumedAt: null, status: "paused" } });
  assert.equal((await viewer.patch(`/api/focus/${f.body.id}`, { action: "complete" })).status, 200);
  assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).actualMinutes, t.actualMinutes, "actual time unchanged");
  assert.equal((await viewer.patch(`/api/focus/${f.body.id}`, { action: "complete", completeTask: true })).status, 400, "ended sessions can't be reused");

  // Security headers on every page.
  const page = await fetch(`${BASE}/`);
  assert.equal(page.headers.get("x-content-type-options"), "nosniff");
  assert.match(page.headers.get("content-security-policy") ?? "", /frame-ancestors 'self'/);
  assert.equal(page.headers.get("x-powered-by"), null);
  const health = await fetch(`${BASE}/api/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(Object.keys(await health.json()).sort(), ["db", "ms", "status"]);

  // The audit log can't be edited or deleted, even with the app's database credentials.
  const row = await prisma.activityLog.findFirstOrThrow();
  await assert.rejects(prisma.activityLog.delete({ where: { id: row.id } }), /append-only/);
});

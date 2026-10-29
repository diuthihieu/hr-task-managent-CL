import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "../client";
import { ADMIN_EMAIL, ADMIN_BOOTSTRAP_PASSWORD, ADMIN_PASSWORD, prisma, admin, contributor, viewer, outsider, s } from "./context";

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
  assert.deepEqual(inv.body.invitations.map((i) => [i.email, i.status, i.hasAccount]), [["contributor@integration.test", "invited", false], ["viewer@integration.test", "invited", false]]);
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

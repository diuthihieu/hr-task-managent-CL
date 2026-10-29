import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "../client";
import { prisma, admin, s } from "./context";

// BUG-31 (product owner's decision):
// (a) a workspace admin's bulk handover (/members/{X}/handover) only works when X is
//     deactivated or has left, or the caller is the workspace owner - so an admin can't
//     take back projects their owner hid from them. Owners transferring a project
//     (/projects/{id}/owner) are unchanged.
// (b) a system admin adds a new account to a workspace only with support access, or
//     when they administer it themselves; resetting a member's password is logged in
//     each of that member's workspaces.
test("handover: admins only for members who left or were deactivated; the owner always", async () => {
  const ws = await admin.post<{ id: string }>("/api/workspaces", { name: "Handover Rules Co" });
  const mk = async (email: string, role: "admin" | "editor") => {
    const u = await prisma.user.create({ data: { email, name: email.split("@")[0], systemRole: "MEMBER", passwordHash: await import("bcryptjs").then((b) => b.hash("Passw0rd1", 4)), mustChangePassword: false, emailVerifiedAt: new Date() } });
    await prisma.workspaceMember.create({ data: { workspaceId: ws.body.id, userId: u.id, role } });
    return u;
  };
  const deputy = await mk("deputy.admin@integration.test", "admin");
  const editor = await mk("hiding.editor@integration.test", "editor");
  const asDeputy = new Client();
  assert.ok(await asDeputy.login("deputy.admin@integration.test", "Passw0rd1"));
  const asEditor = new Client();
  assert.ok(await asEditor.login("hiding.editor@integration.test", "Passw0rd1"));
  const p = await asEditor.post<{ id: string }>(`/api/workspaces/${ws.body.id}/projects`, { name: "Private plan" });
  assert.equal(p.status, 201);
  await prisma.projectHiddenMember.create({ data: { projectId: p.body.id, userId: deputy.id } });

  // An active member's projects can't be taken by a (non-owner) admin - to themselves or anyone.
  const grab = await asDeputy.post(`/api/workspaces/${ws.body.id}/members/${editor.id}/handover`, { toUserId: deputy.id });
  assert.equal(grab.status, 403);
  assert.equal((await prisma.project.findUniqueOrThrow({ where: { id: p.body.id } })).ownerId, editor.id);
  assert.equal(await prisma.projectHiddenMember.count({ where: { projectId: p.body.id, userId: deputy.id } }), 1, "still hidden");

  // Once the member is deactivated, the handover is the recovery path.
  await prisma.user.update({ where: { id: editor.id }, data: { isActive: false } });
  assert.equal((await asDeputy.post(`/api/workspaces/${ws.body.id}/members/${editor.id}/handover`, { toUserId: deputy.id })).status, 200);
  assert.equal((await prisma.project.findUniqueOrThrow({ where: { id: p.body.id } })).ownerId, deputy.id);
});

test("system admins: adding a new account to a workspace needs support access or their own admin role there; resets are logged in the member's workspaces", async () => {
  // A live workspace the system admin isn't a member of.
  const tenant = await prisma.workspace.findFirstOrThrow({ where: { deletedAt: null, members: { none: { user: { email: "admin@integration.test" } } } }, select: { id: true } });
  const other = await admin.post<{ id: string }>("/api/admin/users", { email: "tenant.x@integration.test", name: "Tenant X", workspaceId: tenant.id, workspaceRole: "admin" });
  assert.equal(other.status, 403, "a workspace the system admin doesn't administer");
  assert.equal(await prisma.user.count({ where: { email: "tenant.x@integration.test" } }), 0, "nothing created");
  const own = await admin.post<{ id: string }>("/api/admin/users", { email: "own.ws.member@integration.test", name: "Own WS", workspaceId: s.ws, workspaceRole: "viewer" });
  assert.equal(own.status, 201, "their own workspace (they could invite there anyway)");

  const reset = await admin.patch(`/api/admin/users/${s.contributorId}`, { resetPassword: true });
  assert.equal(reset.status, 200);
  const logged = await prisma.activityLog.findFirst({ where: { workspaceId: s.ws, action: "password_reset", entityId: s.contributorId } });
  assert.ok(logged, "the member's workspace sees that a system admin reset the password");
});

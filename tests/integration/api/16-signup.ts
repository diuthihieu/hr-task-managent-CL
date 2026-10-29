import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "../client";
import { prisma, admin } from "./context";

// BUG-08: an address nobody verified can't create a workspace, join through a
// shared invite link or call AI; SIGNUP_ALLOWED_DOMAINS (integration.test here,
// empty = open in production) limits new accounts, except people with a live invitation.
test("sign-up: allowed domains, the invitation exception, and the verified-email gates", async () => {
  await prisma.rateLimit.deleteMany({ where: { key: { startsWith: "register" } } });
  const anon = new Client();
  // Outside the list and not invited: 403, even when the address already has an account (no 409 to probe with).
  assert.equal((await anon.post("/api/register", { email: "stranger@outside.example", password: "Stranger123", name: "Stranger" })).status, 403);
  await prisma.user.create({ data: { email: "taken@outside.example", name: "Taken", systemRole: "MEMBER", passwordHash: "x" } });
  assert.equal((await anon.post("/api/register", { email: "taken@outside.example", password: "Taken12345", name: "Taken" })).status, 403);

  // Invited by email: the account can be created.
  const ws = await admin.post<{ id: string }>("/api/workspaces", { name: "Signup Gate Co" });
  assert.equal(ws.status, 201);
  assert.equal((await admin.post(`/api/workspaces/${ws.body.id}/members`, { email: "guest@outside.example", role: "viewer" })).status, 201);
  const guest = new Client();
  assert.equal((await guest.post("/api/register", { email: "Guest@Outside.example", password: "Guest12345", name: "Gale Guest" })).status, 201);
  // An invitation to a deleted workspace doesn't count.
  const gone = await admin.post<{ id: string }>("/api/workspaces", { name: "Gone Co" });
  assert.equal((await admin.post(`/api/workspaces/${gone.body.id}/members`, { email: "late@outside.example", role: "viewer" })).status, 201);
  await prisma.workspace.update({ where: { id: gone.body.id }, data: { deletedAt: new Date() } });
  assert.equal((await anon.post("/api/register", { email: "late@outside.example", password: "Late123456", name: "Late" })).status, 403);

  // Not verified yet: the three ways in are closed.
  assert.ok(await guest.login("guest@outside.example", "Guest12345"));
  const link = await admin.post<{ url: string }>(`/api/workspaces/${ws.body.id}/invite-link`, { role: "viewer" });
  const token = link.body.url.split("/invite/")[1];
  const create = await guest.post<{ code?: string }>("/api/workspaces", { name: "Guest Co" });
  assert.equal(create.status, 403);
  assert.equal(create.body.code, "email_unverified");
  const join = await guest.post<{ code?: string }>(`/api/invite/${token}`, { decision: "accept" });
  assert.equal(join.status, 403);
  assert.equal(join.body.code, "email_unverified");
  assert.equal((await guest.post<{ code?: string }>("/api/ai/health", {})).status, 403);
  const id = (await prisma.user.findUniqueOrThrow({ where: { email: "guest@outside.example" } })).id;
  assert.equal(await prisma.workspaceMember.count({ where: { userId: id } }), 0);
  // Declining a link needs no verification (it grants nothing).
  assert.equal((await guest.post(`/api/invite/${token}`, { decision: "decline" })).status, 200);

  // Once verified, all three work.
  assert.equal((await admin.patch(`/api/admin/users/${id}`, { verifyEmail: true })).status, 200);
  assert.equal((await guest.post("/api/workspaces", { name: "Guest Co" })).status, 201);
  assert.equal((await guest.post(`/api/invite/${token}`, { decision: "accept" })).status, 200);
  assert.equal((await guest.post("/api/ai/health", {})).status, 200);
});

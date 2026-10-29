import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma, admin } from "./context";

// BUG-14 (part 1): inviting by email doesn't reveal unverified accounts, and an
// admin can't probe addresses in bulk (100 addresses per hour, after de-duplication).
test("invitations: hasAccount only for verified active accounts; 100 invited addresses per hour", async () => {
  await prisma.rateLimit.deleteMany({ where: { key: { startsWith: "invite-email:" } } });
  const ws = await admin.post<{ id: string }>("/api/workspaces", { name: "Invite Limit Co" });
  await prisma.user.create({ data: { email: "unverified.someone@integration.test", name: "Unverified", systemRole: "MEMBER", passwordHash: "x" } });
  const one = await admin.post<{ invitations: { hasAccount: boolean }[] }>(`/api/workspaces/${ws.body.id}/members`, { email: "unverified.someone@integration.test", role: "viewer" });
  assert.equal(one.status, 201);
  assert.equal(one.body.invitations[0].hasAccount, false, "an unverified account isn't revealed (and isn't notified)");

  // 1 used above; duplicates and case variants count once.
  const batch = (from: number) => Array.from({ length: 50 }, (_, i) => `probe${from + i}@integration.test`);
  assert.equal((await admin.post(`/api/workspaces/${ws.body.id}/members`, { emails: [...batch(0).slice(0, 49), "PROBE0@integration.test"], role: "viewer" })).status, 201, "49 distinct");
  assert.equal((await admin.post(`/api/workspaces/${ws.body.id}/members`, { emails: batch(49), role: "viewer" })).status, 201, "50 more: 100 in total");
  const over = await admin.post(`/api/workspaces/${ws.body.id}/members`, { email: "one.more@integration.test", role: "viewer" });
  assert.equal(over.status, 429);
  assert.equal(await prisma.workspaceInvitation.count({ where: { email: "one.more@integration.test" } }), 0, "nothing is created once over the limit");
  await prisma.rateLimit.deleteMany({ where: { key: { startsWith: "invite-email:" } } });
});

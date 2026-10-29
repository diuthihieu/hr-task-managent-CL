import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "../client";
import { prisma } from "./context";

// BUG-32 part 3: owner changes take the per-workspace owners lock first and read the
// state again inside it, so concurrent requests never leave two owners or none.
async function setup(round: number) {
  const hash = await import("bcryptjs").then((b) => b.hash("Passw0rd1", 4));
  const mk = (n: string) => prisma.user.create({ data: { email: `race${round}.${n}@integration.test`, name: n, systemRole: "MEMBER", passwordHash: hash, mustChangePassword: false, emailVerifiedAt: new Date() } });
  const [a, b, c] = await Promise.all([mk("a"), mk("b"), mk("c")]);
  const ws = await prisma.workspace.create({ data: { name: `Race ${round}`, slug: `race-${round}-${Date.now()}`, createdById: a.id } });
  await prisma.workspaceMember.createMany({ data: [
    { workspaceId: ws.id, userId: a.id, role: "owner" },
    { workspaceId: ws.id, userId: b.id, role: "admin" },
    { workspaceId: ws.id, userId: c.id, role: "admin" },
  ] });
  const asA = new Client();
  assert.ok(await asA.login(a.email, "Passw0rd1"));
  const asC = new Client();
  assert.ok(await asC.login(c.email, "Passw0rd1"));
  return { ws: ws.id, a, b, c, asA, asC };
}
const owners = (ws: string) => prisma.workspaceMember.count({ where: { workspaceId: ws, role: "owner" } });

test("two transfers at once: exactly one owner afterwards", async () => {
  for (let round = 0; round < 4; round++) {
    const { ws, b, c, asA } = await setup(round);
    const res = await Promise.all([asA.post(`/api/workspaces/${ws}/transfer-ownership`, { toUserId: b.id }), asA.post(`/api/workspaces/${ws}/transfer-ownership`, { toUserId: c.id })]);
    assert.equal(res.filter((r) => r.status === 200).length, 1, `round ${round}: one transfer wins (${res.map((r) => r.status)})`);
    assert.equal(await owners(ws), 1, `round ${round}: one owner`);
  }
});

test("a transfer racing a demotion or removal of the new owner never leaves the workspace without an owner", async () => {
  for (let round = 10; round < 14; round++) {
    const { ws, b, asA, asC } = await setup(round);
    const second = round % 2 ? asC.patch(`/api/workspaces/${ws}/members/${b.id}`, { role: "editor" }) : asC.del(`/api/workspaces/${ws}/members/${b.id}`);
    await Promise.all([asA.post(`/api/workspaces/${ws}/transfer-ownership`, { toUserId: b.id }), second]);
    assert.equal(await owners(ws), 1, `round ${round}: still one owner`);
  }
});

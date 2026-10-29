import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "../client";
import { prisma, admin, viewer, s } from "./context";

// BUG-05: every AI call counts against a per-user cap and a system-wide cap
// (checked in generate / streamGenerate, so new AI routes are covered too), and
// the routes that had no limit of their own get one.
const fill = (key: string, count: number) =>
  prisma.rateLimit.upsert({ where: { key }, create: { key, count, resetAt: new Date(Date.now() + 10 * 60_000) }, update: { count, resetAt: new Date(Date.now() + 10 * 60_000) } });
const narrative = (c: Client) => c.post("/api/ai/narrative", { targetKind: "project", targetId: s.project, data: "Tasks by status: Done 3, In progress 2" });

test("AI caps: connection check 5 per 10 minutes, per-user and system-wide caps on every call, agent routes limited", async () => {
  // The connection check: a real 429 (not 200 { ok: false }) on the 6th call.
  const c = new Client();
  assert.ok(await c.login("newbie@integration.test", "Newbie1234"));
  for (let i = 1; i <= 5; i++) assert.equal((await c.post("/api/ai/health", {})).status, 200, `check ${i}`);
  assert.equal((await c.post("/api/ai/health", {})).status, 429, "6th check");

  // Per-user cap, inside generate(): a full bucket refuses the call, and doesn't spend the shared one.
  const viewerId = (await prisma.user.findUniqueOrThrow({ where: { email: "viewer@integration.test" } })).id;
  assert.equal((await narrative(viewer)).status, 200, "baseline");
  const globalBefore = (await prisma.rateLimit.findUnique({ where: { key: "ai-global" } }))?.count ?? 0;
  assert.ok(globalBefore > 0, "the system-wide counter counts calls");
  await fill(`ai-user:${viewerId}`, 10_000);
  assert.equal((await narrative(viewer)).status, 429);
  assert.equal((await prisma.rateLimit.findUnique({ where: { key: "ai-global" } }))?.count, globalBefore, "a refused user doesn't burn the shared cap");
  await prisma.rateLimit.delete({ where: { key: `ai-user:${viewerId}` } });

  // System-wide cap.
  await fill("ai-global", 100_000);
  assert.equal((await narrative(admin)).status, 429);
  await prisma.rateLimit.delete({ where: { key: "ai-global" } });
  assert.equal((await narrative(admin)).status, 200, "back once the window resets");

  // Agent routes (had no server-side limit).
  await fill(`ai-agent:${viewerId}`, 30);
  assert.equal((await viewer.post(`/api/workspaces/${s.ws}/agent-work/skills/suggest`, { description: "Draft a weekly HR status summary" })).status, 429);
  await prisma.rateLimit.delete({ where: { key: `ai-agent:${viewerId}` } });
});

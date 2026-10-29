import { test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { BASE, prisma, admin } from "./context";

// BUG-04: the nightly cron moves audit rows older than the retention period into
// activity_log_archives. activity_logs is append-only (trigger activity_logs_no_delete),
// so the move must run inside a transaction that set `SET LOCAL app.allow_audit_purge`.

const DAY = 86_400_000;
const cron = (auth?: string) => fetch(`${BASE}/api/maintenance/activity-logs`, auth ? { headers: { Authorization: auth } } : {});

test("audit-log archive cron: moves old rows, needs the secret", async () => {
  const old = await prisma.activityLog.create({ data: { entityType: "task", entityId: "00000000-0000-4000-8000-000000000001", action: "updated", summary: "old row for the archive test", createdAt: new Date(Date.now() - 400 * DAY) } });
  assert.equal((await cron()).status, 401, "no secret");
  assert.equal((await cron("Bearer wrong-secret")).status, 401, "wrong secret");
  const res = await cron(`Bearer ${process.env.CRON_SECRET}`);
  const body = (await res.json()) as { archived: number; hasMore: boolean };
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.ok(body.archived >= 1);
  assert.equal(body.hasMore, false);
  assert.equal(await prisma.activityLog.count({ where: { id: old.id } }), 0, "gone from activity_logs");
  assert.equal(await prisma.activityLogArchive.count({ where: { id: old.id } }), 1, "kept in activity_log_archives");
});

test("audit-log archive: the purge switch is SET LOCAL, so the connection stays protected afterwards", async () => {
  const { archiveOldActivityLogs } = await import("../../../src/lib/activity-archive");
  const url = process.env.DATABASE_URL!;
  // One connection: whatever the archive did to the session is visible to the next statement.
  const one = new PrismaClient({ datasources: { db: { url: url + (url.includes("?") ? "&" : "?") + "connection_limit=1" } } });
  try {
    const old = await one.activityLog.create({ data: { entityType: "task", entityId: "00000000-0000-4000-8000-000000000002", action: "updated", summary: "old row on one connection", createdAt: new Date(Date.now() - 400 * DAY) } });
    const fresh = await one.activityLog.create({ data: { entityType: "task", entityId: "00000000-0000-4000-8000-000000000003", action: "updated", summary: "fresh row on one connection" } });
    const moved = await archiveOldActivityLogs(one, new Date(Date.now() - 365 * DAY), 100);
    assert.ok(moved.ids.includes(old.id), "the old row was archived");
    assert.ok(moved.deleted >= moved.ids.length);
    const [{ v }] = await one.$queryRaw<{ v: string | null }[]>`SELECT current_setting('app.allow_audit_purge', true) AS v`;
    assert.notEqual(v, "on", "the switch did not leak onto the pooled connection");
    await assert.rejects(one.activityLog.delete({ where: { id: fresh.id } }), /append-only/);
  } finally {
    await one.$disconnect();
  }
});

// BUG-19: archives keep the security fields, can't be edited or deleted by app code,
// the cron keeps up with large backlogs, and AI usage is rolled up monthly then pruned.
test("audit archive keeps ip / user agent and is append-only", async () => {
  const old = await prisma.activityLog.create({ data: { entityType: "user", entityId: "00000000-0000-4000-8000-000000000004", action: "sign_in_failed", summary: "old failed sign-in", ip: "198.51.100.23", userAgent: "Mozilla/5.0 test-agent", createdAt: new Date(Date.now() - 400 * DAY) } });
  assert.equal((await cron(`Bearer ${process.env.CRON_SECRET}`)).status, 200);
  const kept = await prisma.activityLogArchive.findUniqueOrThrow({ where: { id: old.id } });
  assert.equal(kept.ip, "198.51.100.23");
  assert.equal(kept.userAgent, "Mozilla/5.0 test-agent");
  await assert.rejects(prisma.activityLogArchive.update({ where: { id: old.id }, data: { summary: "rewritten" } }), /append-only/);
  await assert.rejects(prisma.activityLogArchive.delete({ where: { id: old.id } }), /append-only/);
});

test("audit archive cron runs batch after batch in one call (batch size 100 here)", async () => {
  const createdAt = new Date(Date.now() - 500 * DAY);
  const ids = Array.from({ length: 250 }, (_, i) => `00000000-0000-4000-9000-${String(i).padStart(12, "0")}`);
  await prisma.activityLog.createMany({ data: ids.map((id) => ({ id, entityType: "task", entityId: id, action: "updated", summary: "backlog", createdAt })) });
  const res = await cron(`Bearer ${process.env.CRON_SECRET}`);
  const body = (await res.json()) as { archived: number; hasMore: boolean };
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(await prisma.activityLogArchive.count({ where: { id: { in: ids } } }), 250, "all 250 archived in one call");
  assert.equal(await prisma.activityLog.count({ where: { id: { in: ids } } }), 0);
  assert.equal(body.hasMore, false);
});

test("AI usage older than the retention is rolled up by month, then deleted; all-time totals don't change", async () => {
  const ws = await prisma.workspace.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } });
  const at = new Date(Date.UTC(2024, 0, 15));
  const before = await prisma.aiUsageMonthly.findMany({ where: { workspaceId: ws.id, month: new Date(Date.UTC(2024, 0, 1)), feature: "/api/test-rollup" } });
  assert.equal(before.length, 0);
  const old = await prisma.aiUsageEvent.createManyAndReturn({ data: [
    { workspaceId: ws.id, feature: "/api/test-rollup", model: "m1", tokensIn: 10, tokensOut: 5, createdAt: at },
    { workspaceId: ws.id, feature: "/api/test-rollup", model: "m1", tokensIn: 20, tokensOut: 7, createdAt: new Date(at.getTime() + DAY) },
  ] });
  const recent = await prisma.aiUsageEvent.create({ data: { workspaceId: ws.id, feature: "/api/test-rollup", model: "m1", tokensIn: 1, tokensOut: 1 } });
  assert.equal((await cron(`Bearer ${process.env.CRON_SECRET}`)).status, 200);
  assert.equal(await prisma.aiUsageEvent.count({ where: { id: { in: old.map((o) => o.id) } } }), 0, "old events deleted");
  assert.equal(await prisma.aiUsageEvent.count({ where: { id: recent.id } }), 1, "recent event kept");
  const month = await prisma.aiUsageMonthly.findMany({ where: { workspaceId: ws.id, month: new Date(Date.UTC(2024, 0, 1)), feature: "/api/test-rollup" } });
  assert.equal(month.length, 1);
  assert.equal(month[0].requests, 2);
  assert.equal(Number(month[0].tokensIn), 30);
  assert.equal(Number(month[0].tokensOut), 12);
  assert.equal(month[0].lastAt?.toISOString(), new Date(at.getTime() + DAY).toISOString(), "the latest rolled-up call is kept");
});

test("AI usage: a user's last AI use survives the roll-up; the retention never cuts into the 12-week chart", async () => {
  const user = await prisma.user.create({ data: { email: "rolled.up@integration.test", name: "Rolled Up", systemRole: "MEMBER", passwordHash: "x" } });
  const at = new Date(Date.UTC(2024, 2, 10));
  await prisma.aiUsageEvent.create({ data: { userId: user.id, feature: "/api/test-last-ai", tokensIn: 3, tokensOut: 4, createdAt: at } });
  assert.equal((await cron(`Bearer ${process.env.CRON_SECRET}`)).status, 200);
  assert.equal(await prisma.aiUsageEvent.count({ where: { userId: user.id } }), 0, "rolled up");
  const stats = await admin.get<{ userRows: { id: string; lastAiAt: string | null; aiTokensAll: number }[] }>("/api/admin/stats");
  const row = stats.body.userRows.find((u) => u.id === user.id);
  assert.ok(row, "the user is listed");
  assert.equal(row.aiTokensAll, 7);
  assert.equal(new Date(row.lastAiAt as string).toISOString(), at.toISOString(), "last AI use kept");
  // An event 90 days old (inside the 12-week chart) is never rolled up, whatever AI_USAGE_RETENTION_DAYS says.
  const { aiUsageRetentionDays } = await import("../../../src/lib/activity-archive");
  assert.ok(aiUsageRetentionDays({ AI_USAGE_RETENTION_DAYS: "30" }) >= 12 * 7 + 7);
  assert.equal(aiUsageRetentionDays({}), 400);
});

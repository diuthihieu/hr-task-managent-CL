import { test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { BASE, prisma } from "./context";

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
    assert.ok(moved.some((r) => r.id === old.id), "the old row was archived");
    const [{ v }] = await one.$queryRaw<{ v: string | null }[]>`SELECT current_setting('app.allow_audit_purge', true) AS v`;
    assert.notEqual(v, "on", "the switch did not leak onto the pooled connection");
    await assert.rejects(one.activityLog.delete({ where: { id: fresh.id } }), /append-only/);
  } finally {
    await one.$disconnect();
  }
});

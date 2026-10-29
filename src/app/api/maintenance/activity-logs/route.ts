import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { archiveOldActivityLogs, rollUpOldAiUsage } from "@/lib/activity-archive";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** No new batch after this: a batch can take up to 30 s and the function stops at 60 s. */
const BUDGET_MS = 25_000;
const DAY = 24 * 60 * 60 * 1000;

function authorized(req: Request) {
  const configured = process.env.CRON_SECRET;
  const supplied = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!configured || !supplied) return false;
  const a = Buffer.from(configured);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Nightly maintenance, safe for concurrent invocations (lock-skipping batches):
 * moves old audit rows into the archive, batch after batch, then rolls AI usage
 * older than its retention up into monthly totals.
 */
export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const started = Date.now();
  const days = Math.max(30, Math.min(3650, Number(process.env.ACTIVITY_LOG_RETENTION_DAYS) || 365));
  const batch = Math.max(100, Math.min(5000, Number(process.env.ACTIVITY_LOG_ARCHIVE_BATCH) || 2000));
  const cutoff = new Date(started - days * DAY);
  let archived = 0;
  let hasMore = true;
  while (hasMore && Date.now() - started < BUDGET_MS) {
    const r = await archiveOldActivityLogs(prisma, cutoff, batch);
    archived += r.ids.length;
    hasMore = r.deleted === batch;
  }

  const aiDays = Math.max(30, Number(process.env.AI_USAGE_RETENTION_DAYS) || 400);
  const aiCutoff = new Date(started - aiDays * DAY);
  let aiRolledUp = 0;
  let aiHasMore = true;
  while (aiHasMore && Date.now() - started < BUDGET_MS) {
    const deleted = await rollUpOldAiUsage(prisma, aiCutoff, 5000);
    aiRolledUp += deleted;
    aiHasMore = deleted === 5000;
  }
  return NextResponse.json({ archived, cutoff: cutoff.toISOString(), hasMore, aiRolledUp, aiHasMore });
}

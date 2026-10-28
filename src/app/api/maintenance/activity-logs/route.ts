import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { archiveOldActivityLogs } from "@/lib/activity-archive";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request) {
  const configured = process.env.CRON_SECRET;
  const supplied = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!configured || !supplied) return false;
  const a = Buffer.from(configured);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Move old audit rows in a bounded, lock-skipping batch. Safe for concurrent cron invocations. */
export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const days = Math.max(30, Math.min(3650, Number(process.env.ACTIVITY_LOG_RETENTION_DAYS) || 365));
  const batch = Math.max(100, Math.min(5000, Number(process.env.ACTIVITY_LOG_ARCHIVE_BATCH) || 2000));
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const moved = await archiveOldActivityLogs(prisma, cutoff, batch);
  return NextResponse.json({ archived: moved.length, cutoff: cutoff.toISOString(), hasMore: moved.length === batch });
}

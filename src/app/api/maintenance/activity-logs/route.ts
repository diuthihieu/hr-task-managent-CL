import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

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
  const moved = await prisma.$transaction(async (tx) => tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    WITH picked AS (
      SELECT id
      FROM activity_logs
      WHERE created_at < ${cutoff}
      ORDER BY created_at ASC
      LIMIT ${batch}
      FOR UPDATE SKIP LOCKED
    ), deleted AS (
      DELETE FROM activity_logs AS source
      USING picked
      WHERE source.id = picked.id
      RETURNING source.id, source.workspace_id, source.actor_id, source.entity_type,
                source.entity_id, source.action, source.summary, source.changes, source.created_at
    )
    INSERT INTO activity_log_archives
      (id, workspace_id, actor_id, entity_type, entity_id, action, summary, changes, created_at, archived_at)
    SELECT id, workspace_id, actor_id, entity_type, entity_id, action, summary, changes, created_at, NOW()
    FROM deleted
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `));
  return NextResponse.json({ archived: moved.length, cutoff: cutoff.toISOString(), hasMore: moved.length === batch });
}

// Moves audit rows older than the retention cutoff from activity_logs into
// activity_log_archives, one bounded batch per call, and rolls old AI usage up
// into monthly totals. No "server-only" and no @/lib/prisma import, so
// integration tests can call it with their own client.
import { Prisma, type PrismaClient } from "@prisma/client";

/**
 * `ids`: rows archived; `deleted`: rows removed from activity_logs (can exceed
 * ids.length if an id was already archived - ON CONFLICT skips it, but the row
 * still left activity_logs). Loops must go on `deleted`. 30 s timeout: the
 * default 5 s is tight over a remote database.
 */
export async function archiveOldActivityLogs(db: Pick<PrismaClient, "$transaction">, cutoff: Date, batch: number) {
  return db.$transaction(
    async (tx) => {
      // The append-only trigger allows DELETE only inside a transaction that set this.
      // SET LOCAL (never plain SET): it ends with the transaction, so the pooled
      // connection is protected again for every later statement.
      await tx.$executeRaw`SET LOCAL app.allow_audit_purge = 'on'`;
      const [row] = await tx.$queryRaw<Array<{ ids: string[] | null; deleted: number }>>(Prisma.sql`
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
                source.entity_id, source.action, source.summary, source.changes,
                source.ip, source.user_agent, source.created_at
    ), archived AS (
      INSERT INTO activity_log_archives
        (id, workspace_id, actor_id, entity_type, entity_id, action, summary, changes, ip, user_agent, created_at, archived_at)
      SELECT id, workspace_id, actor_id, entity_type, entity_id, action, summary, changes, ip, user_agent, created_at, NOW()
      FROM deleted
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    )
    SELECT (SELECT array_agg(id::text) FROM archived) AS ids, (SELECT count(*)::int FROM deleted) AS deleted
  `);
      return { ids: row?.ids ?? [], deleted: row?.deleted ?? 0 };
    },
    { timeout: 30_000 },
  );
}

/**
 * Deletes ai_usage_events rows older than `cutoff` (one batch) and adds them to
 * ai_usage_monthly in the same statement, so all-time totals never change.
 * Returns the number of rows deleted.
 */
export async function rollUpOldAiUsage(db: Pick<PrismaClient, "$queryRaw">, cutoff: Date, batch: number) {
  const [row] = await db.$queryRaw<Array<{ deleted: number }>>(Prisma.sql`
    WITH picked AS (
      SELECT id FROM ai_usage_events WHERE created_at < ${cutoff} ORDER BY created_at ASC LIMIT ${batch} FOR UPDATE SKIP LOCKED
    ), deleted AS (
      DELETE FROM ai_usage_events AS e USING picked WHERE e.id = picked.id
      RETURNING e.workspace_id, e.user_id, e.feature, e.model, e.tokens_in, e.tokens_out,
                date_trunc('month', e.created_at AT TIME ZONE 'UTC')::date AS month
    ), totals AS (
      SELECT month, workspace_id, user_id, feature, model, count(*)::int AS requests,
             sum(tokens_in)::bigint AS tokens_in, sum(tokens_out)::bigint AS tokens_out
      FROM deleted GROUP BY month, workspace_id, user_id, feature, model
    ), merged AS (
      INSERT INTO ai_usage_monthly (key, month, workspace_id, user_id, feature, model, requests, tokens_in, tokens_out)
      SELECT concat_ws('|', month, coalesce(workspace_id::text, '-'), coalesce(user_id::text, '-'), feature, coalesce(model, '-')),
             month, workspace_id, user_id, feature, model, requests, tokens_in, tokens_out
      FROM totals
      ON CONFLICT (key) DO UPDATE SET
        requests = ai_usage_monthly.requests + EXCLUDED.requests,
        tokens_in = ai_usage_monthly.tokens_in + EXCLUDED.tokens_in,
        tokens_out = ai_usage_monthly.tokens_out + EXCLUDED.tokens_out
      RETURNING 1
    )
    SELECT (SELECT count(*)::int FROM deleted) AS deleted, (SELECT count(*) FROM merged) AS merged
  `);
  return row?.deleted ?? 0;
}

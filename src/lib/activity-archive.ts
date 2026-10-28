// Moves audit rows older than the retention cutoff from activity_logs into
// activity_log_archives, one bounded batch per call. No "server-only" and no
// @/lib/prisma import, so integration tests can call it with their own client.
import { Prisma, type PrismaClient } from "@prisma/client";

/** Returns the ids that were archived. 30 s timeout: the default 5 s is tight over a remote database. */
export async function archiveOldActivityLogs(db: Pick<PrismaClient, "$transaction">, cutoff: Date, batch: number) {
  return db.$transaction(
    async (tx) => {
      // The append-only trigger allows DELETE only inside a transaction that set this.
      // SET LOCAL (never plain SET): it ends with the transaction, so the pooled
      // connection is protected again for every later statement.
      await tx.$executeRaw`SET LOCAL app.allow_audit_purge = 'on'`;
      return tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
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
  `);
    },
    { timeout: 30_000 },
  );
}

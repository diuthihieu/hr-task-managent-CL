import type { ActivityLog } from "@prisma/client";
import type { ActivityRow } from "@/types";

export function serializeActivity(a: ActivityLog & { actor: { id: string; name: string; avatarColor: string } | null }): ActivityRow {
  return {
    id: a.id,
    entityType: a.entityType,
    entityId: a.entityId,
    action: a.action,
    summary: a.summary,
    changes: (a.changes as ActivityRow["changes"]) ?? null,
    actor: a.actor,
    createdAt: a.createdAt.toISOString(),
  };
}

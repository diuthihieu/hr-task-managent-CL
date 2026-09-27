// Activity log writer. Always called inside the same transaction as the
// change it describes, so a log row exists if and only if the change
// committed.

import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

export type EntityType =
  | "user"
  | "workspace"
  | "member"
  | "project"
  | "task"
  | "comment"
  | "attachment"
  | "custom_field"
  | "status"
  | "category"
  | "view"
  | "objective"
  | "key_result"
  | "dashboard"
  | "desktop_release"
  | "wiki_page";

export type ActivityAction =
  | "created"
  | "updated"
  | "deleted"
  | "restored"
  | "assigned"
  | "unassigned"
  | "status_changed"
  | "password_reset"
  | "deactivated"
  | "activated"
  | "role_changed"
  | "published"
  | "unpublished";

export interface ActivityInput {
  workspaceId: string | null;
  actorId: string | null;
  entityType: EntityType;
  entityId: string;
  action: ActivityAction;
  summary?: string;
  changes?: Record<string, { from: unknown; to: unknown }> | null;
}

export async function logActivity(tx: Tx, input: ActivityInput) {
  await tx.activityLog.create({
    data: {
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      summary: input.summary ?? null,
      changes: input.changes ? (JSON.parse(JSON.stringify(input.changes)) as Prisma.InputJsonValue) : undefined,
    },
  });
}

function normalize(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (v && typeof v === "object" && "toFixed" in (v as object) && typeof (v as { toString: () => string }).toString === "function" && !Array.isArray(v)) {
    // Prisma.Decimal
    return Number((v as { toString: () => string }).toString());
  }
  if (Array.isArray(v)) return [...v].map(normalize).sort();
  return v ?? null;
}

/** `{ key: { from, to } }` for every key whose value actually changed. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>, keys?: string[]): Record<string, { from: unknown; to: unknown }> | null {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of keys ?? Object.keys(after)) {
    if (!(k in after)) continue;
    const a = normalize(before[k]);
    const b = normalize(after[k]);
    if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = { from: a, to: b };
  }
  return Object.keys(out).length ? out : null;
}

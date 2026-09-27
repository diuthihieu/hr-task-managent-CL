import type { Prisma } from "@prisma/client";

const SESSION_MS = 15 * 60 * 1000;

/** True unless the same user already logged a page edit on this entity in the last 15 minutes. */
export async function shouldLogContentEdit(tx: Prisma.TransactionClient, entityType: string, entityId: string, actorId: string) {
  const recent = await tx.activityLog.findFirst({
    where: { entityType, entityId, actorId, summary: { startsWith: "Edited the page" }, createdAt: { gte: new Date(Date.now() - SESSION_MS) } },
    select: { id: true },
  });
  return !recent;
}

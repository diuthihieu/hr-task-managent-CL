// A notification is pushed once. Reminders are created on demand by several requests at the same time
// (bell, Home, Action center opening together): the database keeps one row (dedupe key), but every request
// used to queue a push for it - one phone got the same "Due soon" three times. The sender that sets
// pushed_at first sends it; the others see the row already claimed and skip it.
import type { PrismaClient } from "@prisma/client";

type Db = Pick<PrismaClient, "notification">;

/** True for exactly one caller per notification, whatever the concurrency (an atomic conditional UPDATE). */
export async function claimForPush(db: Db, notificationId: string): Promise<boolean> {
  const { count } = await db.notification.updateMany({ where: { id: notificationId, pushedAt: null }, data: { pushedAt: new Date() } });
  return count === 1;
}

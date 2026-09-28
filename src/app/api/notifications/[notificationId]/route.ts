import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, route, readJson, notFound, badRequest } from "@/lib/authz";
import { quickTaskAction } from "@/lib/task-quick";

type P = { notificationId: string };

const schema = z.object({
  read: z.boolean().optional(),
  /** Hide until this time (ISO) - Snooze. null = unsnooze. */
  snoozeUntil: z.string().datetime().nullable().optional(),
  /** Accept / Done: moves it out of the "To do" list. */
  actioned: z.boolean().optional(),
  /** Complete: marks the linked task done (and the notification actioned). */
  completeTask: z.literal(true).optional(),
});

/** Act on one of the caller's notifications: read, snooze, accept/done, complete the task. */
export const PATCH = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { notificationId } = await params;
  const body = schema.parse(await readJson(req));
  const n = await prisma.notification.findFirst({ where: { id: notificationId, userId: user.id } });
  if (!n) throw notFound("Notification");

  if (body.completeTask) {
    if (!n.taskId) throw badRequest("This notification has no task");
    await quickTaskAction(user, n.taskId, "complete", "the action center");
  }

  const now = new Date();
  await prisma.notification.update({
    where: { id: n.id },
    data: {
      ...(body.read !== undefined ? { readAt: body.read ? (n.readAt ?? now) : null } : {}),
      ...(body.snoozeUntil !== undefined ? { snoozedUntil: body.snoozeUntil ? new Date(body.snoozeUntil) : null, readAt: n.readAt ?? now } : {}),
      ...(body.actioned !== undefined ? { actionedAt: body.actioned ? now : null, readAt: n.readAt ?? now } : {}),
      ...(body.completeTask ? { actionedAt: now, readAt: n.readAt ?? now } : {}),
    },
  });
  return NextResponse.json({ ok: true });
});

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, route, readJson } from "@/lib/authz";
import { actOnNotification } from "@/server/notifications/actions";

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
  await actOnNotification(user, notificationId, schema.parse(await readJson(req)));
  return NextResponse.json({ ok: true });
});

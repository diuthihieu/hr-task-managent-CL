import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, route, readJson, notFound } from "@/lib/authz";

type P = { notificationId: string };

/** Mark one of the caller's notifications read or unread. */
export const PATCH = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { notificationId } = await params;
  const { read } = z.object({ read: z.boolean() }).parse(await readJson(req));
  const res = await prisma.notification.updateMany({ where: { id: notificationId, userId: user.id }, data: { readAt: read ? new Date() : null } });
  if (!res.count) throw notFound("Notification");
  return NextResponse.json({ ok: true });
});

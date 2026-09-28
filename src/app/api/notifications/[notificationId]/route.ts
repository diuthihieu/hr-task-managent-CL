import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, assertCanEditTask, route, readJson, notFound, badRequest, workspaceOfTask } from "@/lib/authz";
import { applyTaskPatch, SYS } from "@/lib/task-grid";
import { notifyTaskPatched } from "@/lib/notifications";
import { logActivity } from "@/lib/activity";

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
    const ctx = await requireWorkspaceRole(user, await workspaceOfTask(n.taskId), "contributor");
    await assertCanEditTask(ctx, n.taskId);
    const done = await prisma.status.findFirst({ where: { workspaceId: ctx.workspaceId, category: "done" }, orderBy: { sortOrder: "asc" } });
    if (!done) throw badRequest("This workspace has no 'done' status");
    const task = await prisma.task.findUniqueOrThrow({ where: { id: n.taskId }, select: { projectId: true } });
    await prisma.$transaction(async (tx) => {
      const res = await applyTaskPatch(tx, { taskId: n.taskId!, projectId: task.projectId, workspaceId: ctx.workspaceId, actorId: user.id, data: { [SYS.status]: done.id } });
      if (Object.keys(res.changes).length) {
        await notifyTaskPatched(tx, { taskId: n.taskId!, actorId: user.id, changedKeys: Object.keys(res.changes), statusChanged: res.statusChanged, newStatusName: res.newStatusName, assigned: [], reportAdded: [] });
        await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "task", entityId: n.taskId!, action: "updated", changes: res.changes, summary: "Completed from the inbox" });
      }
    });
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

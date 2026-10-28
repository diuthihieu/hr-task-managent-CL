// What a person does with their own notifications: read, snooze, accept / done,
// complete the linked task, answer a role change. Every lookup is scoped to the
// caller, so nobody can act on someone else's notification.
import "server-only";
import type { WorkspaceRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { notFound, badRequest, HttpError, type SessionUser } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { ROLE_RANK, assertKeepsAnOwner } from "@/lib/member-roles";
import { quickTaskAction } from "@/lib/task-quick";

export async function markAllRead(userId: string): Promise<number> {
  const res = await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
  return res.count;
}

export interface NotificationAction {
  read?: boolean;
  /** Hide until this time (ISO) - Snooze. null = unsnooze. */
  snoozeUntil?: string | null;
  /** Accept / Done: moves it out of the "To do" list. */
  actioned?: boolean;
  /** Complete: marks the linked task done (and the notification actioned). */
  completeTask?: true;
}

/** Act on one of the caller's notifications: read, snooze, accept/done, complete the task. */
export async function actOnNotification(user: SessionUser, notificationId: string, body: NotificationAction) {
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
}

/**
 * Answer a "your role changed" notification. Accepting only acknowledges it.
 * Declining is offered for promotions only: the person goes back to their
 * previous (lower) role - never higher - so a decline can't be used to regain
 * access an admin took away. It only applies while the role is still the one
 * in the notification.
 */
export async function answerRoleChange(user: SessionUser, notificationId: string, decision: "accept" | "decline"): Promise<{ role: WorkspaceRole }> {
  const n = await prisma.notification.findFirst({ where: { id: notificationId, userId: user.id, type: "role_changed" } });
  if (!n || !n.workspaceId) throw notFound("Notification");
  if (n.actionedAt) throw new HttpError(409, "You already answered this change", "already_answered");
  const { from, to } = (n.data ?? {}) as { from?: WorkspaceRole; to?: WorkspaceRole };
  if (!from || !to || !(from in ROLE_RANK) || !(to in ROLE_RANK)) throw notFound("Notification");
  const workspaceId = n.workspaceId;

  return prisma.$transaction(async (tx) => {
    const member = await tx.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: user.id } } });
    if (!member) throw notFound("Workspace");
    if (decision === "decline") {
      if (ROLE_RANK[from] >= ROLE_RANK[to]) throw new HttpError(400, "Only a promotion can be declined - ask a workspace admin about this change", "not_a_promotion");
      if (member.role !== to) throw new HttpError(409, "Your role has changed again since then", "role_changed_again");
      if (to === "owner") await assertKeepsAnOwner(tx, workspaceId, user.id);
      await tx.workspaceMember.update({ where: { workspaceId_userId: { workspaceId, userId: user.id } }, data: { role: from } });
      await logActivity(tx, { workspaceId, actorId: user.id, entityType: "member", entityId: user.id, action: "role_changed", summary: `${user.name} declined the ${to} role`, changes: { role: { from: to, to: from } } });
    }
    await tx.notification.update({ where: { id: n.id }, data: { actionedAt: new Date(), readAt: n.readAt ?? new Date() } });
    if (n.actorId && n.actorId !== user.id) {
      const ws = await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { name: true, slug: true } });
      await tx.notification.create({
        data: { userId: n.actorId, workspaceId, actorId: user.id, type: "role_change_result", title: ws.name, body: user.name, data: { decision: decision === "accept" ? "accepted" : "declined", from, to }, link: `/w/${ws.slug}/settings?section=members` },
      });
    }
    return { role: decision === "decline" ? from : member.role };
  });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import type { WorkspaceRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser, route, readJson, notFound, HttpError } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { ROLE_RANK, assertKeepsAnOwner } from "@/lib/member-roles";

type P = { notificationId: string };
const schema = z.object({ decision: z.enum(["accept", "decline"]) });

/**
 * Answer a "your role changed" notification. Accepting only acknowledges it.
 * Declining is offered for promotions only: the person goes back to their
 * previous (lower) role - never higher - so a decline can't be used to regain
 * access an admin took away. It only applies while the role is still the one
 * in the notification.
 */
export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { notificationId } = await params;
  const { decision } = schema.parse(await readJson(req));
  const n = await prisma.notification.findFirst({ where: { id: notificationId, userId: user.id, type: "role_changed" } });
  if (!n || !n.workspaceId) throw notFound("Notification");
  if (n.actionedAt) throw new HttpError(409, "You already answered this change", "already_answered");
  const { from, to } = (n.data ?? {}) as { from?: WorkspaceRole; to?: WorkspaceRole };
  if (!from || !to || !(from in ROLE_RANK) || !(to in ROLE_RANK)) throw notFound("Notification");
  const workspaceId = n.workspaceId;

  const result = await prisma.$transaction(async (tx) => {
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
  return NextResponse.json(result);
});

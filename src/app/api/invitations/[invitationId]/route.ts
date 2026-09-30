import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, notFound, badRequest } from "@/lib/authz";
import { logActivity } from "@/lib/activity";

type P = { invitationId: string };

/** Revoke a pending invitation (workspace admins). Its link stops working and it leaves the invitee's Action Center. */
export const DELETE = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { invitationId } = await params;
  const inv = await prisma.workspaceInvitation.findUnique({ where: { id: invitationId } });
  if (!inv) throw notFound("Invitation");
  await requireWorkspaceRole(user, inv.workspaceId, "admin");
  if (inv.status !== "pending") throw badRequest("This invitation was already answered");
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.workspaceInvitation.update({ where: { id: invitationId }, data: { status: "revoked", respondedAt: now } });
    await tx.notification.updateMany({ where: { dedupeKey: `invite:${invitationId}` }, data: { actionedAt: now, readAt: now } });
    await logActivity(tx, { workspaceId: inv.workspaceId, actorId: user.id, entityType: "member", entityId: inv.id, action: "deleted", summary: `Revoked the invitation for ${inv.email}` });
  });
  return new NextResponse(null, { status: 204 });
});

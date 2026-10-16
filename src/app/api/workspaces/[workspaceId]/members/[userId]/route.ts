import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, forbidden, notFound } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { workspaceRoleSchema } from "@/lib/validation";
import { assertKeepsAnOwner, applyRoleChange } from "@/lib/member-roles";

type P = { workspaceId: string; userId: string };

export const PATCH = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId, userId } = await params;
  await requireWorkspaceRole(user, workspaceId, "admin");
  const { role } = z.object({ role: workspaceRoleSchema }).parse(await readJson(req));
  const m = await prisma.$transaction((tx) => applyRoleChange(tx, { workspaceId, actorId: user.id, userId, role }));
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, name: true, email: true, avatarColor: true, isActive: true } });
  return NextResponse.json({ ...u, role: m.role });
});

/** Remove a member (admins), or leave the workspace yourself (any member). */
export const DELETE = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { workspaceId, userId } = await params;
  const ctx = await requireWorkspaceRole(user, workspaceId, userId === user.id ? "viewer" : "admin");
  const target = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } });
  if (!target) throw notFound("Member");
  if (target.role === "owner") {
    if (ctx.role !== "owner" && userId !== user.id) throw forbidden("Only owners can remove an owner");
  }
  await prisma.$transaction(async (tx) => {
    if (target.role === "owner") await assertKeepsAnOwner(tx, workspaceId, userId);
    // Unassign from this workspace's tasks, then drop the membership.
    await tx.taskAssignee.deleteMany({ where: { userId, task: { workspaceId } } });
    await tx.taskReportRecipient.deleteMany({ where: { userId, task: { workspaceId } } });
    await tx.projectHiddenMember.deleteMany({ where: { userId, project: { workspaceId } } });
    await tx.wikiMember.deleteMany({ where: { userId, wiki: { workspaceId } } });
    await tx.workspaceMember.delete({ where: { workspaceId_userId: { workspaceId, userId } } });
    await logActivity(tx, { workspaceId, actorId: user.id, entityType: "member", entityId: userId, action: "deleted" });
  });
  return new NextResponse(null, { status: 204 });
});

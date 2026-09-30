import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, forbidden, notFound } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { workspaceRoleSchema } from "@/lib/validation";
import { assertKeepsAnOwner } from "@/lib/member-roles";

type P = { workspaceId: string; userId: string };

export const PATCH = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId, userId } = await params;
  const ctx = await requireWorkspaceRole(user, workspaceId, "admin");
  const { role } = z.object({ role: workspaceRoleSchema }).parse(await readJson(req));
  const target = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } });
  if (!target) throw notFound("Member");
  if ((role === "owner" || target.role === "owner") && ctx.role !== "owner") throw forbidden("Only owners can grant or remove the owner role");
  const updated = await prisma.$transaction(async (tx) => {
    if (target.role === "owner" && role !== "owner") await assertKeepsAnOwner(tx, workspaceId, userId);
    const m = await tx.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId, userId } },
      data: { role },
      include: { user: { select: { id: true, name: true, email: true, avatarColor: true, isActive: true } } },
    });
    // Admins and owners manage every project, so nothing can stay hidden from them.
    if (role === "owner" || role === "admin") await tx.projectHiddenMember.deleteMany({ where: { userId, project: { workspaceId } } });
    await logActivity(tx, { workspaceId, actorId: user.id, entityType: "member", entityId: userId, action: "role_changed", changes: { role: { from: target.role, to: role } } });
    // Tell the person: they see what changed, and may decline a promotion.
    if (role !== target.role && userId !== user.id) {
      const ws = await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { name: true, slug: true } });
      await tx.notification.create({
        data: { userId, workspaceId, actorId: user.id, type: "role_changed", title: ws.name, data: { from: target.role, to: role }, link: `/w/${ws.slug}` },
      });
    }
    return m;
  });
  return NextResponse.json({ ...updated.user, role: updated.role });
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

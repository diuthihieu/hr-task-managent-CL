import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, badRequest, notFound } from "@/lib/authz";
import { logActivity } from "@/lib/activity";

type P = { workspaceId: string };
const schema = z.object({
  toUserId: z.string().uuid(),
  /** Your role after the transfer. */
  myNewRole: z.enum(["admin", "editor", "contributor", "viewer"]).default("admin"),
});

/**
 * An owner hands the workspace over: the chosen member becomes an owner and the
 * caller steps down to the role they pick, in one transaction, under the same
 * per-workspace owners lock as other owner changes.
 */
export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "owner");
  const { toUserId, myNewRole } = schema.parse(await readJson(req));
  if (toUserId === user.id) throw badRequest("Choose another member");
  const target = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: toUserId } }, include: { user: { select: { name: true, isActive: true } } } });
  if (!target) throw notFound("Member");
  if (!target.user.isActive) throw badRequest("This account is deactivated");
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"ws-owners:" + workspaceId}))`;
    await tx.workspaceMember.update({ where: { workspaceId_userId: { workspaceId, userId: toUserId } }, data: { role: "owner" } });
    await tx.workspaceMember.update({ where: { workspaceId_userId: { workspaceId, userId: user.id } }, data: { role: myNewRole } });
    await logActivity(tx, { workspaceId, actorId: user.id, entityType: "member", entityId: toUserId, action: "role_changed", summary: `Workspace ownership transferred to ${target.user.name}`, changes: { role: { from: target.role, to: "owner" } } });
    await logActivity(tx, { workspaceId, actorId: user.id, entityType: "member", entityId: user.id, action: "role_changed", summary: `${user.name} stepped down after transferring ownership`, changes: { role: { from: "owner", to: myNewRole } } });
    if (target.role !== "owner") {
      const ws = await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { name: true, slug: true } });
      await tx.notification.create({ data: { userId: toUserId, workspaceId, actorId: user.id, type: "role_changed", title: ws.name, data: { from: target.role, to: "owner" }, link: `/w/${ws.slug}` } });
    }
  });
  return NextResponse.json({ ok: true, myRole: myNewRole });
});

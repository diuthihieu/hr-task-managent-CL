import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfProject, assertCanManageProject, badRequest } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { uuid } from "@/lib/validation";

type P = { projectId: string };

/**
 * Project visibility. By default every workspace member sees a project; the
 * project owner/creator (or a workspace admin) can hide it from chosen members.
 * `members` lists everyone who could be hidden, with `lockedReason` for those
 * who can't (workspace owners/admins, the project owner/creator, yourself).
 */
export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { projectId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfProject(projectId), "viewer");
  const [project, members, hidden] = await Promise.all([
    prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { ownerId: true, createdById: true } }),
    prisma.workspaceMember.findMany({ where: { workspaceId: ctx.workspaceId }, include: { user: { select: { id: true, name: true, email: true, avatarColor: true } } }, orderBy: { createdAt: "asc" } }),
    prisma.projectHiddenMember.findMany({ where: { projectId }, select: { userId: true } }),
  ]);
  let canManage = true;
  try {
    await assertCanManageProject(ctx, projectId);
  } catch {
    canManage = false;
  }
  const hiddenIds = new Set(hidden.map((h) => h.userId));
  return NextResponse.json({
    canManage,
    hiddenUserIds: [...hiddenIds],
    members: members.map((m) => ({
      ...m.user,
      role: m.role,
      hidden: hiddenIds.has(m.userId),
      lockedReason: lockedReason(m.userId, m.role, project, user.id),
    })),
  });
});

function lockedReason(userId: string, role: string, project: { ownerId: string | null; createdById: string | null }, me: string) {
  if (role === "owner" || role === "admin") return "admin";
  if (userId === project.ownerId || userId === project.createdById) return "project_owner";
  if (userId === me) return "self";
  return null;
}

const schema = z.object({ hiddenUserIds: z.array(uuid).max(10_000) });

/** Replace the hidden-member list. */
export const PUT = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { projectId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfProject(projectId), "editor");
  await assertCanManageProject(ctx, projectId);
  const body = schema.parse(await readJson(req));
  const wanted = [...new Set(body.hiddenUserIds)];
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { ownerId: true, createdById: true, name: true } });
  const members = await prisma.workspaceMember.findMany({ where: { workspaceId: ctx.workspaceId, userId: { in: wanted } }, select: { userId: true, role: true } });
  if (members.length !== wanted.length) throw badRequest("Only workspace members can be hidden from a project");
  for (const m of members) {
    const reason = lockedReason(m.userId, m.role, project, user.id);
    if (reason === "admin") throw badRequest("Workspace owners and admins can always see every project");
    if (reason === "project_owner") throw badRequest("The project owner and creator can always see the project");
    if (reason === "self") throw badRequest("You can't hide a project from yourself");
  }
  await prisma.$transaction(async (tx) => {
    const before = await tx.projectHiddenMember.findMany({ where: { projectId }, select: { userId: true } });
    const beforeIds = new Set(before.map((b) => b.userId));
    const add = wanted.filter((id) => !beforeIds.has(id));
    const remove = [...beforeIds].filter((id) => !wanted.includes(id));
    if (remove.length) await tx.projectHiddenMember.deleteMany({ where: { projectId, userId: { in: remove } } });
    if (add.length) await tx.projectHiddenMember.createMany({ data: add.map((userId) => ({ projectId, userId, createdById: user.id })) });
    if (add.length || remove.length)
      await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "project", entityId: projectId, action: "updated", changes: { hiddenFrom: { from: [...beforeIds], to: wanted } } });
  });
  return NextResponse.json({ hiddenUserIds: wanted });
});

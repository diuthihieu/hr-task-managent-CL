import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, badRequest, forbidden, notFound } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { PROJECT_OWNER_ROLES, ownedProjectsWhere } from "@/lib/member-roles";

type P = { workspaceId: string; userId: string };
const schema = z.object({ toUserId: z.string().uuid() });

/** What a member owns that can be handed over: projects, objectives, key results. */
async function owned(workspaceId: string, userId: string) {
  const [projects, objectives, keyResults] = await Promise.all([
    prisma.project.count({ where: ownedProjectsWhere(workspaceId, userId) }),
    prisma.objective.count({ where: { workspaceId, ownerId: userId, deletedAt: null } }),
    prisma.keyResult.count({ where: { ownerId: userId, deletedAt: null, objective: { workspaceId } } }),
  ]);
  return { projects, objectives, keyResults };
}

/** Counts of what the member owns (admins). */
export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { workspaceId, userId } = await params;
  await requireWorkspaceRole(user, workspaceId, "admin");
  return NextResponse.json(await owned(workspaceId, userId));
});

/**
 * Hand over everything a member owns (e.g. someone leaving or changing role):
 * their projects, objectives and key results get the new owner. Admins may do
 * it once the member is deactivated or has left; while the member is active
 * only the workspace owner may (BUG-31) - otherwise an admin could take back a
 * project its owner hid from them. Owners hand over a single project through
 * /projects/{id}/owner as before.
 */
export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId, userId } = await params;
  const ctx = await requireWorkspaceRole(user, workspaceId, "admin");
  const { toUserId } = schema.parse(await readJson(req));
  if (ctx.role !== "owner") {
    const source = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } }, select: { user: { select: { isActive: true, deletedAt: true } } } });
    if (source && source.user.isActive && !source.user.deletedAt) throw forbidden("Only the workspace owner can hand over an active member's work - deactivate or remove the member first");
  }
  if (toUserId === userId) throw badRequest("Choose another member");
  const to = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: toUserId } }, include: { user: { select: { name: true, isActive: true } } } });
  if (!to) throw notFound("Member");
  if (!to.user.isActive) throw badRequest("This account is deactivated");
  if (!PROJECT_OWNER_ROLES.includes(to.role) && (await prisma.project.count({ where: ownedProjectsWhere(workspaceId, userId) })))
    throw badRequest("Projects can only be handed to an editor or above");
  const result = await prisma.$transaction(async (tx) => {
    const projectIds = (await tx.project.findMany({ where: ownedProjectsWhere(workspaceId, userId), select: { id: true } })).map((p) => p.id);
    await tx.project.updateMany({ where: { id: { in: projectIds } }, data: { ownerId: toUserId, updatedById: user.id } });
    // The new owner must be able to see the projects they now own.
    await tx.projectHiddenMember.deleteMany({ where: { userId: toUserId, projectId: { in: projectIds } } });
    // ...and has full rights there (no narrowed copy kept).
    await tx.projectMemberPermission.deleteMany({ where: { userId: toUserId, projectId: { in: projectIds } } });
    const objectives = await tx.objective.updateMany({ where: { workspaceId, ownerId: userId, deletedAt: null }, data: { ownerId: toUserId } });
    const keyResults = await tx.keyResult.updateMany({ where: { ownerId: userId, deletedAt: null, objective: { workspaceId } }, data: { ownerId: toUserId } });
    const counts = { projects: projectIds.length, objectives: objectives.count, keyResults: keyResults.count };
    await logActivity(tx, { workspaceId, actorId: user.id, entityType: "member", entityId: userId, action: "updated", summary: `Handed over ${counts.projects} project(s), ${counts.objectives} objective(s), ${counts.keyResults} key result(s) to ${to.user.name}`, changes: { owner: { from: userId, to: toUserId } } });
    return counts;
  });
  return NextResponse.json(result);
});

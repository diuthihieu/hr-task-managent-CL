import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, badRequest, notFound } from "@/lib/authz";
import { logActivity } from "@/lib/activity";

type P = { workspaceId: string; userId: string };
const schema = z.object({ toUserId: z.string().uuid() });

/** What a member owns that can be handed over: projects, objectives, key results. */
async function owned(workspaceId: string, userId: string) {
  const [projects, objectives, keyResults] = await Promise.all([
    prisma.project.count({ where: { workspaceId, ownerId: userId, deletedAt: null } }),
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
 * their projects, objectives and key results get the new owner. Admins only.
 */
export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId, userId } = await params;
  await requireWorkspaceRole(user, workspaceId, "admin");
  const { toUserId } = schema.parse(await readJson(req));
  if (toUserId === userId) throw badRequest("Choose another member");
  const to = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: toUserId } }, include: { user: { select: { name: true, isActive: true } } } });
  if (!to) throw notFound("Member");
  if (!to.user.isActive) throw badRequest("This account is deactivated");
  const result = await prisma.$transaction(async (tx) => {
    const projectIds = (await tx.project.findMany({ where: { workspaceId, ownerId: userId, deletedAt: null }, select: { id: true } })).map((p) => p.id);
    await tx.project.updateMany({ where: { id: { in: projectIds } }, data: { ownerId: toUserId, updatedById: user.id } });
    // The new owner must be able to see the projects they now own.
    await tx.projectHiddenMember.deleteMany({ where: { userId: toUserId, projectId: { in: projectIds } } });
    const objectives = await tx.objective.updateMany({ where: { workspaceId, ownerId: userId, deletedAt: null }, data: { ownerId: toUserId } });
    const keyResults = await tx.keyResult.updateMany({ where: { ownerId: userId, deletedAt: null, objective: { workspaceId } }, data: { ownerId: toUserId } });
    const counts = { projects: projectIds.length, objectives: objectives.count, keyResults: keyResults.count };
    await logActivity(tx, { workspaceId, actorId: user.id, entityType: "member", entityId: userId, action: "updated", summary: `Handed over ${counts.projects} project(s), ${counts.objectives} objective(s), ${counts.keyResults} key result(s) to ${to.user.name}`, changes: { owner: { from: userId, to: toUserId } } });
    return counts;
  });
  return NextResponse.json(result);
});

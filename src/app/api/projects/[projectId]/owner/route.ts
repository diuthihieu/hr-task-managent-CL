import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfProject, assertCanManageProject, badRequest } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { uuid } from "@/lib/validation";
import { projectOwner } from "@/lib/project-permissions";
import { PROJECT_OWNER_ROLES } from "@/lib/member-roles";

type P = { projectId: string };
const schema = z.object({ toUserId: uuid });

/**
 * Hand the project over to another member. Only the project owner (or, for an
 * owner-less project, a workspace owner/admin) can. The new owner must be an
 * active editor or above, sees the project and gets full rights; the previous
 * owner keeps their role's default rights in it.
 */
export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { projectId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfProject(projectId), "viewer");
  await assertCanManageProject(ctx, projectId);
  const { toUserId } = schema.parse(await readJson(req));
  const [current, target, project] = await Promise.all([
    projectOwner(projectId),
    prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId: toUserId } }, include: { user: { select: { name: true, isActive: true } } } }),
    prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { name: true, workspace: { select: { slug: true } } } }),
  ]);
  if (toUserId === current.id) throw badRequest("They already own this project");
  if (!target || !target.user.isActive) throw badRequest("Choose an active workspace member");
  if (!PROJECT_OWNER_ROLES.includes(target.role)) throw badRequest("The project owner must be an editor or above - change their workspace role first");
  await prisma.$transaction(async (tx) => {
    await tx.project.update({ where: { id: projectId }, data: { ownerId: toUserId, updatedById: user.id } });
    // The new owner must see the project and has full rights (no narrowed copy kept).
    await tx.projectHiddenMember.deleteMany({ where: { projectId, userId: toUserId } });
    await tx.projectMemberPermission.deleteMany({ where: { projectId, userId: toUserId } });
    await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "project", entityId: projectId, action: "updated", summary: `Handed project "${project.name}" over to ${target.user.name}`, changes: { ownerId: { from: current.id, to: toUserId } } });
    if (toUserId !== user.id)
      await tx.notification.create({
        data: { userId: toUserId, workspaceId: ctx.workspaceId, projectId, actorId: user.id, type: "project_owner", title: project.name, body: user.name, data: { project: project.name }, link: `/w/${project.workspace.slug}/p/${projectId}/settings` },
      });
  });
  return NextResponse.json({ ownerId: toUserId });
});

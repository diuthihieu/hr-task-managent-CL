import "server-only";
import type { WorkspaceRole } from "@prisma/client";
import { prisma } from "./prisma";
import { forbidden, supportAccess, type WorkspaceContext } from "./authz";
import { effectiveCaps, type ProjectCap } from "./project-caps";

/** Project owner = the project's owner or its creator (they always have full rights). */
export async function isProjectOwner(userId: string, projectId: string) {
  return !!(await prisma.project.findFirst({ where: { id: projectId, OR: [{ ownerId: userId }, { createdById: userId }] }, select: { id: true } }));
}

/** The caller's capabilities in a project. */
export async function projectCaps(ctx: Pick<WorkspaceContext, "user" | "role">, projectId: string): Promise<Set<ProjectCap>> {
  const role: WorkspaceRole = supportAccess(ctx.user) ? "owner" : ctx.role;
  if (role === "owner" || role === "admin") return new Set(effectiveCaps(role, true, null));
  const [owner, row] = await Promise.all([
    isProjectOwner(ctx.user.id, projectId),
    prisma.projectMemberPermission.findUnique({ where: { projectId_userId: { projectId, userId: ctx.user.id } }, select: { permissions: true } }),
  ]);
  return new Set(effectiveCaps(role, owner, row?.permissions ?? null));
}

const MESSAGES: Record<ProjectCap, string> = {
  "task.create": "You can't create tasks in this project",
  "task.edit_own": "You can't edit tasks in this project",
  "task.edit_all": "You can only edit tasks you created or are assigned to in this project",
  "task.delete": "You can't delete tasks in this project",
  "task.comment": "You can't comment in this project",
  "fields.manage": "Only the project owner or someone they allow can add or change columns",
  "views.create": "You can't add views in this project",
  "views.manage": "You can't change views in this project",
  "okr.manage": "You can't manage this project's objectives",
  "settings.manage": "Only the project owner or someone they allow can change the project settings",
};

export async function assertProjectCap(ctx: Pick<WorkspaceContext, "user" | "role">, projectId: string, cap: ProjectCap) {
  if (!(await projectCaps(ctx, projectId)).has(cap)) throw forbidden(MESSAGES[cap]);
}

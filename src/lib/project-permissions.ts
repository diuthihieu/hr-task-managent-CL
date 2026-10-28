import "server-only";
import type { WorkspaceRole } from "@prisma/client";
import { prisma } from "./prisma";
import { supportAccess, type WorkspaceContext } from "./access";
import { forbidden } from "./http-errors";
import { effectiveCaps, PROJECT_CAPS, type ProjectCap } from "./project-caps";
import { canDeleteView } from "./view-permissions";

type Ctx = Pick<WorkspaceContext, "user" | "role">;

/**
 * The project owner: `ownerId`, or the creator for projects that never had
 * one. Handing the project over (or the creator leaving) moves it.
 * `active` is false when that person is no longer an active member.
 */
export async function projectOwner(projectId: string): Promise<{ id: string | null; active: boolean }> {
  const p = await prisma.project.findUnique({ where: { id: projectId }, select: { ownerId: true, createdById: true, workspaceId: true } });
  const id = p ? p.ownerId ?? p.createdById : null;
  if (!p || !id) return { id: null, active: false };
  const m = await prisma.workspaceMember.findFirst({ where: { workspaceId: p.workspaceId, userId: id, user: { isActive: true, deletedAt: null } }, select: { userId: true } });
  return { id, active: !!m };
}

/**
 * Who runs a project (its settings, permissions, hand-over, moving its data):
 * the project owner - above the workspace owner/admins inside the project.
 * When the project has no active owner, workspace owners/admins step in so a
 * project can never be orphaned.
 */
export async function canManageProject(ctx: Ctx, projectId: string) {
  if (supportAccess(ctx.user)) return true;
  const owner = await projectOwner(projectId);
  if (owner.id === ctx.user.id) return true;
  return !owner.active && (ctx.role === "owner" || ctx.role === "admin");
}

export async function isProjectOwner(userId: string, projectId: string) {
  return (await projectOwner(projectId)).id === userId;
}

/**
 * The caller's capabilities in a project: the project owner (or the stand-in
 * admin of an owner-less project) has everything their role allows; everyone
 * else - workspace owners/admins included - has what the project owner set,
 * or their role's defaults.
 */
export async function projectCaps(ctx: Ctx, projectId: string): Promise<Set<ProjectCap>> {
  if (supportAccess(ctx.user)) return new Set(PROJECT_CAPS);
  const role: WorkspaceRole = ctx.role;
  const [manager, row] = await Promise.all([
    canManageProject(ctx, projectId),
    prisma.projectMemberPermission.findUnique({ where: { projectId_userId: { projectId, userId: ctx.user.id } }, select: { permissions: true } }),
  ]);
  return new Set(effectiveCaps(role, manager, row?.permissions ?? null));
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

export async function assertProjectCap(ctx: Ctx, projectId: string, cap: ProjectCap) {
  if (!(await projectCaps(ctx, projectId)).has(cap)) throw forbidden(MESSAGES[cap]);
}

/** The caller's rights on a project's views, for API checks and the canEdit/canDelete flags. */
export async function viewRights(ctx: Ctx, projectId: string) {
  const [caps, manager] = await Promise.all([projectCaps(ctx, projectId), canManageProject(ctx, projectId)]);
  const canEdit = caps.has("views.manage");
  return {
    canEdit,
    canDelete: (view: { createdById: string | null; isBase: boolean }) =>
      canDeleteView({ isProjectManager: manager, canManageViews: canEdit, canCreateViews: caps.has("views.create"), userId: ctx.user.id, viewCreatedById: view.createdById, isBase: view.isBase }),
  };
}

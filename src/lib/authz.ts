// Central authentication + authorization for every route handler.
//
// Rules:
// - The session cookie only proves *who* the caller claims to be. Every
//   request re-loads the user row, so deactivating or deleting an account
//   takes effect immediately, not when the JWT expires.
// - Every resource is resolved to its workspace, then the caller's role in
//   that workspace is checked against the minimum role the action needs.
// - System ADMINs act as workspace owners everywhere (support/break-glass).

import { NextResponse } from "next/server";
import { Prisma, type SystemRole, type WorkspaceRole } from "@prisma/client";
import { ZodError } from "zod";
import { auth } from "./auth";
import { prisma } from "./prisma";

export { HttpError, unauthorized, forbidden, notFound, badRequest } from "./http-errors";
import { HttpError, unauthorized, forbidden, notFound, badRequest } from "./http-errors";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  systemRole: SystemRole;
  mustChangePassword: boolean;
  avatarColor: string;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  const id = (session?.user as { id?: string } | undefined)?.id;
  if (!id) return null;
  const user = await prisma.user.findFirst({
    where: { id, isActive: true, deletedAt: null },
    select: { id: true, email: true, name: true, systemRole: true, mustChangePassword: true, avatarColor: true },
  });
  return user;
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw unauthorized();
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.systemRole !== "ADMIN") throw forbidden("Admin only");
  return user;
}

const ROLE_RANK: Record<WorkspaceRole, number> = { viewer: 0, contributor: 1, editor: 2, admin: 3, owner: 4 };

export function roleAtLeast(role: WorkspaceRole | null | undefined, min: WorkspaceRole): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

/** The caller's effective role in a workspace, or null if they have no access. */
export async function effectiveRole(user: SessionUser, workspaceId: string): Promise<WorkspaceRole | null> {
  const workspace = await prisma.workspace.findFirst({ where: { id: workspaceId, deletedAt: null }, select: { id: true } });
  if (!workspace) return null;
  if (user.systemRole === "ADMIN") return "owner";
  const m = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: user.id } },
    select: { role: true },
  });
  return m?.role ?? null;
}

export interface WorkspaceContext {
  user: SessionUser;
  workspaceId: string;
  role: WorkspaceRole;
}

/** Throws 404 when the workspace is missing or the caller isn't a member (don't leak existence), 403 when the role is too low. */
export async function requireWorkspaceRole(user: SessionUser, workspaceId: string | null | undefined, min: WorkspaceRole): Promise<WorkspaceContext> {
  if (!workspaceId) throw notFound();
  const role = await effectiveRole(user, workspaceId);
  if (!role) throw notFound();
  if (!roleAtLeast(role, min)) throw forbidden();
  return { user, workspaceId, role };
}

// ---------------------------------------------------------------------------
// Resource -> workspace resolvers (soft-deleted rows resolve to null)
// ---------------------------------------------------------------------------

export async function workspaceOfProject(projectId: string) {
  const p = await prisma.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { workspaceId: true } });
  return p?.workspaceId ?? null;
}
export async function workspaceOfTask(taskId: string) {
  const t = await prisma.task.findFirst({ where: { id: taskId, deletedAt: null }, select: { workspaceId: true } });
  return t?.workspaceId ?? null;
}
export async function workspaceOfView(viewId: string) {
  const v = await prisma.view.findFirst({ where: { id: viewId, project: { deletedAt: null } }, select: { project: { select: { workspaceId: true } } } });
  return v?.project.workspaceId ?? null;
}
export async function workspaceOfCustomField(fieldId: string) {
  const f = await prisma.customField.findFirst({ where: { id: fieldId, deletedAt: null, project: { deletedAt: null } }, select: { project: { select: { workspaceId: true } } } });
  return f?.project.workspaceId ?? null;
}
export async function workspaceOfComment(commentId: string) {
  const c = await prisma.comment.findFirst({ where: { id: commentId, deletedAt: null, task: { deletedAt: null } }, select: { task: { select: { workspaceId: true } } } });
  return c?.task.workspaceId ?? null;
}
export async function workspaceOfAttachment(attachmentId: string) {
  const a = await prisma.attachment.findFirst({ where: { id: attachmentId, deletedAt: null, task: { deletedAt: null } }, select: { workspaceId: true } });
  return a?.workspaceId ?? null;
}
export async function workspaceOfObjective(objectiveId: string) {
  const o = await prisma.objective.findFirst({ where: { id: objectiveId, deletedAt: null }, select: { workspaceId: true } });
  return o?.workspaceId ?? null;
}
export async function workspaceOfKeyResult(keyResultId: string) {
  const k = await prisma.keyResult.findFirst({ where: { id: keyResultId, deletedAt: null, objective: { deletedAt: null } }, select: { objective: { select: { workspaceId: true } } } });
  return k?.objective.workspaceId ?? null;
}
export async function workspaceOfDashboard(dashboardId: string) {
  const d = await prisma.dashboard.findUnique({ where: { id: dashboardId }, select: { workspaceId: true } });
  return d?.workspaceId ?? null;
}
export async function workspaceOfWidget(widgetId: string) {
  const w = await prisma.dashboardWidget.findUnique({ where: { id: widgetId }, select: { dashboard: { select: { workspaceId: true } } } });
  return w?.dashboard.workspaceId ?? null;
}
export async function workspaceOfThought(thoughtId: string) {
  const t = await prisma.capturedThought.findUnique({ where: { id: thoughtId }, select: { workspaceId: true } });
  return t?.workspaceId ?? null;
}
export async function workspaceOfStatus(statusId: string) {
  const s = await prisma.status.findUnique({ where: { id: statusId }, select: { workspaceId: true } });
  return s?.workspaceId ?? null;
}
export async function workspaceOfCategory(categoryId: string) {
  const c = await prisma.category.findUnique({ where: { id: categoryId }, select: { workspaceId: true } });
  return c?.workspaceId ?? null;
}

/**
 * Contributors may only edit tasks they created or are assigned to; editors
 * and above may edit any task in the workspace.
 */
export async function assertCanEditTask(ctx: WorkspaceContext, taskId: string) {
  if (roleAtLeast(ctx.role, "editor")) return;
  if (ctx.role !== "contributor") throw forbidden();
  const task = await prisma.task.findFirst({
    where: { id: taskId, deletedAt: null, OR: [{ createdById: ctx.user.id }, { assignees: { some: { userId: ctx.user.id } } }] },
    select: { id: true },
  });
  if (!task) throw forbidden("Contributors can only edit tasks they created or are assigned to");
}

// ---------------------------------------------------------------------------
// Route wrapper: consistent JSON errors, no stack traces to clients.
// ---------------------------------------------------------------------------

type Handler<P> = (req: Request, ctx: { params: Promise<P> }) => Promise<Response>;

export function route<P = Record<string, string>>(handler: Handler<P>): Handler<P> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

// Friendly messages for the CHECK constraints in the constraints migration.
const CONSTRAINT_MESSAGES: Record<string, string> = {
  tasks_date_range: "Due date must be on or after the start date",
  projects_date_range: "End date must be on or after the start date",
  objectives_date_range: "End date must be on or after the start date",
  tasks_progress_range: "Progress must be between 0 and 100",
  tasks_title_not_blank: "Task name is required",
  task_dependencies_no_self: "A task cannot depend on itself",
  tasks_not_own_parent: "A task cannot be its own parent",
  objectives_confidence_range: "Confidence must be between 0 and 100",
  users_email_format: "Email address is not valid",
  comments_body_not_blank: "Comment cannot be empty",
};

const TRIGGER_MESSAGE = /(task (?:project|status|category|key result) must belong to the task workspace|parent task must belong to the same project|assignee must be a member of the task workspace|custom field must be defined on the task project|option does not belong to this custom field|dependent tasks must belong to the same workspace)/;

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof ZodError) {
    const first = e.issues[0];
    const path = first?.path.join(".");
    return NextResponse.json({ error: path ? `${path}: ${first.message}` : first?.message ?? "Invalid input", issues: e.issues }, { status: 400 });
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2002") return NextResponse.json({ error: "A record with this value already exists" }, { status: 409 });
    if (e.code === "P2003") return NextResponse.json({ error: "This item is still referenced by other data" }, { status: 409 });
    if (e.code === "P2025") return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError || e instanceof Prisma.PrismaClientUnknownRequestError) {
    // Never echo raw database errors (they include row contents) - map them.
    const constraint = e.message.match(/violates check constraint \\?"([a-z_]+)\\?"/)?.[1];
    if (constraint) return NextResponse.json({ error: CONSTRAINT_MESSAGES[constraint] ?? "Invalid data" }, { status: 400 });
    const trigger = e.message.match(TRIGGER_MESSAGE)?.[1];
    if (trigger) return NextResponse.json({ error: trigger[0].toUpperCase() + trigger.slice(1) }, { status: 400 });
  }
  console.error(e);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export async function readJson<T = unknown>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw badRequest("Request body must be JSON");
  }
}

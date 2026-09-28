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
  locale: string;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  const id = (session?.user as { id?: string } | undefined)?.id;
  if (!id) return null;
  const user = await prisma.user.findFirst({
    where: { id, isActive: true, deletedAt: null },
    select: { id: true, email: true, name: true, systemRole: true, mustChangePassword: true, avatarColor: true, locale: true },
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
  /** Set when the request targets something that lives inside a project. */
  projectId?: string;
  /** Set when the request targets something inside a wiki; `wikiRole` is the caller's role there. */
  wikiId?: string;
  wikiRole?: WikiRoleName;
}

/** What a resource resolves to: its workspace, plus its project when it has one. */
export interface Scope {
  workspaceId: string;
  projectId?: string | null;
  wikiId?: string | null;
}

/** True when a project's creator/admin hid it from this user. System admins are never hidden. */
export async function isProjectHiddenFrom(user: SessionUser, projectId: string): Promise<boolean> {
  if (user.systemRole === "ADMIN") return false;
  const row = await prisma.projectHiddenMember.findUnique({ where: { projectId_userId: { projectId, userId: user.id } }, select: { projectId: true } });
  return !!row;
}

/** Ids of projects hidden from this user (empty for system admins). */
export async function hiddenProjectIds(user: SessionUser): Promise<Set<string>> {
  if (user.systemRole === "ADMIN") return new Set();
  const rows = await prisma.projectHiddenMember.findMany({ where: { userId: user.id }, select: { projectId: true } });
  return new Set(rows.map((r) => r.projectId));
}

/** Prisma filter for "projects this user may see" — combine into every project/task listing. */
export function visibleProjectWhere(user: SessionUser) {
  return user.systemRole === "ADMIN" ? {} : { hiddenMembers: { none: { userId: user.id } } };
}

/**
 * Throws 404 when the workspace is missing, the caller isn't a member, or the
 * target project is hidden from them (don't leak existence); 403 when the role is too low.
 */
export async function requireWorkspaceRole(user: SessionUser, target: string | Scope | null | undefined, min: WorkspaceRole): Promise<WorkspaceContext> {
  if (!target) throw notFound();
  const scope: Scope = typeof target === "string" ? { workspaceId: target } : target;
  const role = await effectiveRole(user, scope.workspaceId);
  if (!role) throw notFound();
  if (scope.projectId && (await isProjectHiddenFrom(user, scope.projectId))) throw notFound();
  let wikiRole: WikiRoleName | undefined;
  if (scope.wikiId) {
    const r = await wikiRoleOf(user, scope.wikiId, role);
    if (!r) throw notFound();
    wikiRole = r;
  }
  if (!roleAtLeast(role, min)) throw forbidden();
  return { user, workspaceId: scope.workspaceId, role, projectId: scope.projectId ?? undefined, wikiId: scope.wikiId ?? undefined, wikiRole };
}

// ---------------------------------------------------------------------------
// Resource -> scope resolvers (soft-deleted rows resolve to null)
// ---------------------------------------------------------------------------

export async function workspaceOfProject(projectId: string): Promise<Scope | null> {
  const p = await prisma.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { workspaceId: true } });
  return p ? { workspaceId: p.workspaceId, projectId } : null;
}
export async function workspaceOfTask(taskId: string): Promise<Scope | null> {
  const t = await prisma.task.findFirst({ where: { id: taskId, deletedAt: null }, select: { workspaceId: true, projectId: true } });
  return t ? { workspaceId: t.workspaceId, projectId: t.projectId } : null;
}
export async function workspaceOfView(viewId: string): Promise<Scope | null> {
  const v = await prisma.view.findFirst({ where: { id: viewId, project: { deletedAt: null } }, select: { projectId: true, project: { select: { workspaceId: true } } } });
  return v ? { workspaceId: v.project.workspaceId, projectId: v.projectId } : null;
}
export async function workspaceOfCustomField(fieldId: string): Promise<Scope | null> {
  const f = await prisma.customField.findFirst({ where: { id: fieldId, deletedAt: null, project: { deletedAt: null } }, select: { projectId: true, project: { select: { workspaceId: true } } } });
  return f ? { workspaceId: f.project.workspaceId, projectId: f.projectId } : null;
}
export async function workspaceOfComment(commentId: string): Promise<Scope | null> {
  const c = await prisma.comment.findFirst({ where: { id: commentId, deletedAt: null, task: { deletedAt: null } }, select: { task: { select: { workspaceId: true, projectId: true } } } });
  return c ? { workspaceId: c.task.workspaceId, projectId: c.task.projectId } : null;
}
export async function workspaceOfAttachment(attachmentId: string): Promise<Scope | null> {
  const a = await prisma.attachment.findFirst({
    where: { id: attachmentId, deletedAt: null, OR: [{ task: { deletedAt: null } }, { wikiPage: { deletedAt: null } }] },
    select: { workspaceId: true, task: { select: { projectId: true } }, wikiPage: { select: { wikiId: true } } },
  });
  return a ? { workspaceId: a.workspaceId, projectId: a.task?.projectId ?? null, wikiId: a.wikiPage?.wikiId ?? null } : null;
}
export async function workspaceOfObjective(objectiveId: string): Promise<Scope | null> {
  const o = await prisma.objective.findFirst({ where: { id: objectiveId, deletedAt: null }, select: { workspaceId: true, projectId: true } });
  return o ? { workspaceId: o.workspaceId, projectId: o.projectId } : null;
}
export async function workspaceOfKeyResult(keyResultId: string): Promise<Scope | null> {
  const k = await prisma.keyResult.findFirst({ where: { id: keyResultId, deletedAt: null, objective: { deletedAt: null } }, select: { objective: { select: { workspaceId: true, projectId: true } } } });
  return k ? { workspaceId: k.objective.workspaceId, projectId: k.objective.projectId } : null;
}
export async function workspaceOfDashboard(dashboardId: string) {
  const d = await prisma.dashboard.findUnique({ where: { id: dashboardId }, select: { workspaceId: true } });
  return d?.workspaceId ?? null;
}
export async function workspaceOfWidget(widgetId: string) {
  const w = await prisma.dashboardWidget.findUnique({ where: { id: widgetId }, select: { dashboard: { select: { workspaceId: true } } } });
  return w?.dashboard.workspaceId ?? null;
}
/** Thoughts are private to their author; the project check happens at convert time. */
export async function workspaceOfThought(thoughtId: string) {
  const t = await prisma.capturedThought.findUnique({ where: { id: thoughtId }, select: { workspaceId: true } });
  return t?.workspaceId ?? null;
}
export async function workspaceOfStatus(statusId: string) {
  const s = await prisma.status.findUnique({ where: { id: statusId }, select: { workspaceId: true } });
  return s?.workspaceId ?? null;
}
export async function workspaceOfWikiPage(pageId: string): Promise<Scope | null> {
  const p = await prisma.wikiPage.findFirst({ where: { id: pageId, deletedAt: null, wiki: { deletedAt: null } }, select: { workspaceId: true, wikiId: true } });
  return p ? { workspaceId: p.workspaceId, wikiId: p.wikiId } : null;
}
export async function workspaceOfWiki(wikiId: string): Promise<Scope | null> {
  const w = await prisma.wiki.findFirst({ where: { id: wikiId, deletedAt: null }, select: { workspaceId: true } });
  return w ? { workspaceId: w.workspaceId, wikiId } : null;
}
export async function workspaceOfCategory(categoryId: string): Promise<Scope | null> {
  const c = await prisma.category.findUnique({ where: { id: categoryId }, select: { workspaceId: true, projectId: true } });
  return c ? { workspaceId: c.workspaceId, projectId: c.projectId } : null;
}

// ---------------------------------------------------------------------------
// Wikis: workspace-level knowledge spaces with their own access rule.
// ---------------------------------------------------------------------------

export type WikiRoleName = "viewer" | "editor" | "manager";
const WIKI_RANK: Record<WikiRoleName, number> = { viewer: 0, editor: 1, manager: 2 };
export const wikiRoleAtLeast = (r: WikiRoleName | null | undefined, min: WikiRoleName) => !!r && WIKI_RANK[r] >= WIKI_RANK[min];

/**
 * The caller's role in a wiki, or null when they can't see it.
 * Workspace owners/admins and the wiki's creator manage it; explicit members
 * get their role; on workspace-wide wikis everyone else gets the default role.
 * Workspace viewers are read-only everywhere, so they never edit.
 */
export async function wikiRoleOf(user: SessionUser, wikiId: string, workspaceRole: WorkspaceRole): Promise<WikiRoleName | null> {
  const w = await prisma.wiki.findFirst({ where: { id: wikiId, deletedAt: null }, select: { access: true, defaultRole: true, createdById: true, members: { where: { userId: user.id }, select: { role: true } } } });
  if (!w) return null;
  if (roleAtLeast(workspaceRole, "admin") || w.createdById === user.id) return "manager";
  const explicit = w.members[0]?.role as WikiRoleName | undefined;
  const implied: WikiRoleName | undefined = w.access === "workspace" ? (w.defaultRole as WikiRoleName) : undefined;
  let r: WikiRoleName | undefined = explicit && implied ? (WIKI_RANK[explicit] >= WIKI_RANK[implied] ? explicit : implied) : (explicit ?? implied);
  if (!r) return null;
  if (workspaceRole === "viewer" && r !== "manager") r = "viewer";
  return r;
}

/** Wiki access + minimum wiki role; 404 when the wiki is invisible, 403 when the role is too low. */
export async function requireWiki(user: SessionUser, wikiId: string, min: WikiRoleName) {
  const ctx = await requireWorkspaceRole(user, await workspaceOfWiki(wikiId), "viewer");
  if (!wikiRoleAtLeast(ctx.wikiRole, min)) throw forbidden(min === "manager" ? "Only the wiki's managers can change this" : "You can only read this wiki");
  return ctx as WorkspaceContext & { wikiId: string; wikiRole: WikiRoleName };
}

/** Prisma filter for "wikis this user may open" in a workspace where they have `role`. */
export function visibleWikiWhere(user: SessionUser, role: WorkspaceRole) {
  if (user.systemRole === "ADMIN" || roleAtLeast(role, "admin")) return { deletedAt: null };
  return { deletedAt: null, OR: [{ access: "workspace" as const }, { createdById: user.id }, { members: { some: { userId: user.id } } }] };
}

/** Workspace admins/owners manage every project; editors manage the projects they own or created. */
export async function assertCanManageProject(ctx: WorkspaceContext, projectId: string) {
  if (roleAtLeast(ctx.role, "admin")) return;
  const p = await prisma.project.findFirst({ where: { id: projectId, OR: [{ ownerId: ctx.user.id }, { createdById: ctx.user.id }] }, select: { id: true } });
  if (!p) throw forbidden("Only the project owner or a workspace admin can change this project");
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
  tasks_key_result_needs_objective: "A key result must be linked together with its objective",
  wiki_pages_title_not_blank: "Page title is required",
  users_locale_supported: "Unsupported language",
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

const TRIGGER_MESSAGE = /(task (?:project|status|category|key result|objective) must belong to the task (?:workspace|project|objective)|parent (?:page|task) must belong to the same project|parent key result must belong to another objective in the workspace|assignee must be a member of the task workspace|custom field must be defined on the task project|option does not belong to this custom field|dependent tasks must belong to the same workspace|report recipient must be a member of the task workspace|hidden member must be a member of the project workspace|project must belong to the same workspace|wiki must belong to the same workspace|wiki member must be a member of the wiki workspace|wiki page must belong to a wiki of its workspace|parent page must belong to the same wiki|focus session task must belong to the session workspace|wiki comment page must belong to the comment workspace|wiki comment reply must be on the same page as its parent|wiki comment attachment must be on the comment page|approval task must belong to the approval workspace|approver must be a member of the task workspace)/;

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

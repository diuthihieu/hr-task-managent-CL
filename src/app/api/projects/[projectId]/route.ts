import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfProject, notFound, badRequest, assertCanManageProject } from "@/lib/authz";
import { logActivity, diff } from "@/lib/activity";
import { dateOnlyToDate, projectInputSchema } from "@/lib/validation";
import { loadProjectMeta, buildFields } from "@/lib/task-grid";
import { serializeProject, serializeView } from "@/lib/serializers";
import { makeT, normalizeLocale } from "@/lib/i18n/core";

type P = { projectId: string };

/** Everything the project workspace needs except the task rows: fields, views, members, the caller's role. */
export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { projectId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfProject(projectId), "viewer");
  const meta = await loadProjectMeta(projectId);
  if (!meta) throw notFound("Project");
  const [project, views, members, workspace] = await Promise.all([
    prisma.project.findUniqueOrThrow({ where: { id: projectId } }),
    prisma.view.findMany({ where: { projectId }, orderBy: { sortOrder: "asc" } }),
    prisma.workspaceMember.findMany({
      where: { workspaceId: ctx.workspaceId, user: { isActive: true, deletedAt: null } },
      include: { user: { select: { id: true, name: true, avatarColor: true } } },
    }),
    prisma.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId }, select: { id: true, slug: true, name: true } }),
  ]);
  return NextResponse.json({
    ...serializeProject(project),
    fields: buildFields(meta, makeT(normalizeLocale(user.locale))),
    views: views.map(serializeView),
    members: members.map((m) => m.user),
    myRole: ctx.role,
    workspace,
  });
});

export const PATCH = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { projectId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfProject(projectId), "editor");
  await assertCanManageProject(ctx, projectId);
  const raw = await readJson<Record<string, unknown>>(req);
  const body = projectInputSchema.partial().parse(raw);
  const order = typeof raw.order === "number" ? Math.round(raw.order) : undefined;
  if (body.ownerId && !(await prisma.workspaceMember.findFirst({ where: { workspaceId: ctx.workspaceId, userId: body.ownerId } }))) throw badRequest("Owner must be a workspace member");
  const project = await prisma.$transaction(async (tx) => {
    const before = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
    const after = await tx.project.update({
      where: { id: projectId },
      data: {
        name: body.name,
        description: body.description,
        color: body.color,
        icon: body.icon,
        status: body.status,
        ownerId: body.ownerId,
        startDate: dateOnlyToDate(body.startDate),
        endDate: dateOnlyToDate(body.endDate),
        sortOrder: order,
        updatedById: user.id,
      },
    });
    if (body.ownerId) await tx.projectHiddenMember.deleteMany({ where: { projectId, userId: body.ownerId } });
    const changes = diff(before, after, ["name", "description", "color", "icon", "status", "ownerId", "startDate", "endDate"]);
    if (changes) await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "project", entityId: projectId, action: "updated", changes });
    return after;
  });
  return NextResponse.json(serializeProject(project));
});

/** Soft delete: the project and its tasks disappear from every list but stay recoverable in the database. */
export const DELETE = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { projectId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfProject(projectId), "editor");
  await assertCanManageProject(ctx, projectId);
  await prisma.$transaction(async (tx) => {
    const p = await tx.project.update({ where: { id: projectId }, data: { deletedAt: new Date(), deletedById: user.id } });
    await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "project", entityId: projectId, action: "deleted", summary: `Deleted project "${p.name}"` });
  });
  return new NextResponse(null, { status: 204 });
});

import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, roleAtLeast, route, readJson, workspaceOfProject } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { serializeView } from "@/lib/serializers";
import { viewTypeSchema } from "@/lib/custom-fields";
import { canDeleteView } from "@/lib/view-permissions";

type P = { projectId: string };

export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { projectId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfProject(projectId), "viewer");
  const [views, project] = await Promise.all([
    prisma.view.findMany({ where: { projectId }, orderBy: { sortOrder: "asc" } }),
    prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { createdById: true } }),
  ]);
  return NextResponse.json(views.map((view) => serializeView(view, { canEdit: roleAtLeast(ctx.role, "editor"), canDelete: canDeleteView({ workspaceRole: ctx.role, userId: user.id, projectCreatedById: project.createdById, viewCreatedById: view.createdById, isBase: view.isBase }) })));
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: viewTypeSchema.default("grid"),
  config: z.record(z.string(), z.unknown()).optional(),
});

export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { projectId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfProject(projectId), "viewer");
  const body = createSchema.parse(await readJson(req));
  const view = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM projects WHERE id = ${projectId}::uuid FOR UPDATE`);
    const last = await tx.view.aggregate({ where: { projectId }, _max: { sortOrder: true } });
    const v = await tx.view.create({
      data: {
        projectId,
        name: body.name,
        type: body.type,
        config: (body.config ?? {}) as Prisma.InputJsonValue,
        sortOrder: (last._max.sortOrder ?? 0) + 1,
        createdById: user.id,
        updatedById: user.id,
      },
    });
    await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "view", entityId: v.id, action: "created", summary: `Created ${v.type} view "${v.name}"`, changes: { projectId: { from: null, to: projectId } } });
    return v;
  });
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { createdById: true } });
  return NextResponse.json(serializeView(view, { canEdit: roleAtLeast(ctx.role, "editor"), canDelete: canDeleteView({ workspaceRole: ctx.role, userId: user.id, projectCreatedById: project.createdById, viewCreatedById: view.createdById, isBase: view.isBase }) }), { status: 201 });
});

import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfProject } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { serializeView } from "@/lib/serializers";
import { viewTypeSchema } from "@/lib/custom-fields";

type P = { projectId: string };

export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { projectId } = await params;
  await requireWorkspaceRole(user, await workspaceOfProject(projectId), "viewer");
  const views = await prisma.view.findMany({ where: { projectId }, orderBy: { sortOrder: "asc" } });
  return NextResponse.json(views.map(serializeView));
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: viewTypeSchema.default("grid"),
  config: z.record(z.string(), z.unknown()).optional(),
});

export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { projectId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfProject(projectId), "editor");
  const body = createSchema.parse(await readJson(req));
  const last = await prisma.view.aggregate({ where: { projectId }, _max: { sortOrder: true } });
  const view = await prisma.$transaction(async (tx) => {
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
    await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "view", entityId: v.id, action: "created", summary: `Created ${v.type} view "${v.name}"` });
    return v;
  });
  return NextResponse.json(serializeView(view), { status: 201 });
});

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfProject } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { serializeCategory } from "@/lib/serializers";
import { categorySchema } from "@/lib/validation";

type P = { projectId: string };

/** Categories are configured per project. */
export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { projectId } = await params;
  await requireWorkspaceRole(user, await workspaceOfProject(projectId), "viewer");
  const rows = await prisma.category.findMany({
    where: { projectId },
    orderBy: { sortOrder: "asc" },
    include: { _count: { select: { tasks: { where: { deletedAt: null } } } } },
  });
  return NextResponse.json(rows.map(serializeCategory));
});

export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { projectId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfProject(projectId), "editor");
  const body = categorySchema.parse(await readJson(req));
  const last = await prisma.category.aggregate({ where: { projectId }, _max: { sortOrder: true } });
  const category = await prisma.$transaction(async (tx) => {
    const c = await tx.category.create({
      data: { workspaceId: ctx.workspaceId, projectId, ...body, sortOrder: (last._max.sortOrder ?? -1) + 1, createdById: user.id, updatedById: user.id },
    });
    await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "category", entityId: c.id, action: "created", summary: `Added category "${c.name}"` });
    return c;
  });
  return NextResponse.json(serializeCategory(category), { status: 201 });
});

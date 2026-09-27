import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { serializeStatus } from "@/lib/serializers";
import { statusSchema } from "@/lib/validation";

type P = { workspaceId: string };

export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "viewer");
  const rows = await prisma.status.findMany({
    where: { workspaceId },
    orderBy: { sortOrder: "asc" },
    include: { _count: { select: { tasks: { where: { deletedAt: null } } } } },
  });
  return NextResponse.json(rows.map(serializeStatus));
});

export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "admin");
  const body = statusSchema.parse(await readJson(req));
  const last = await prisma.status.aggregate({ where: { workspaceId }, _max: { sortOrder: true } });
  const status = await prisma.$transaction(async (tx) => {
    if (body.isDefault) await tx.status.updateMany({ where: { workspaceId }, data: { isDefault: false } });
    const s = await tx.status.create({ data: { workspaceId, ...body, sortOrder: (last._max.sortOrder ?? -1) + 1, createdById: user.id, updatedById: user.id } });
    await logActivity(tx, { workspaceId, actorId: user.id, entityType: "status", entityId: s.id, action: "created", summary: `Added status "${s.name}" (${s.category})` });
    return s;
  });
  return NextResponse.json(serializeStatus(status), { status: 201 });
});

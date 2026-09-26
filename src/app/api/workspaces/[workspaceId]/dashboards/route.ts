import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { serializeDashboard } from "@/lib/dashboard-serialize";

type P = { workspaceId: string };

export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "viewer");
  const rows = await prisma.dashboard.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" }, include: { _count: { select: { widgets: true } } } });
  return NextResponse.json(rows.map((d) => ({ ...serializeDashboard(d), widgetCount: d._count.widgets })));
});

export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "editor");
  const { name } = z.object({ name: z.string().trim().min(1).max(120).default("Untitled dashboard") }).parse(await readJson(req));
  const d = await prisma.$transaction(async (tx) => {
    const created = await tx.dashboard.create({ data: { workspaceId, name, createdById: user.id, updatedById: user.id } });
    await logActivity(tx, { workspaceId, actorId: user.id, entityType: "dashboard", entityId: created.id, action: "created", summary: `Created dashboard "${name}"` });
    return created;
  });
  return NextResponse.json(serializeDashboard(d), { status: 201 });
});

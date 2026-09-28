import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfDashboard, visibleProjectWhere } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { serializeDashboard } from "@/lib/dashboard-serialize";

type P = { dashboardId: string };

export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { dashboardId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfDashboard(dashboardId), "viewer");
  const [d, projects] = await Promise.all([
    prisma.dashboard.findUniqueOrThrow({ where: { id: dashboardId }, include: { widgets: { orderBy: { sortOrder: "asc" } } } }),
    prisma.project.findMany({ where: { workspaceId: ctx.workspaceId, deletedAt: null, ...visibleProjectWhere(user) }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
  ]);
  return NextResponse.json({ ...serializeDashboard(d), projects, myRole: ctx.role });
});

const patchSchema = z.object({ name: z.string().trim().min(1).max(120).optional(), filters: z.record(z.string(), z.unknown()).optional() });

export const PATCH = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { dashboardId } = await params;
  await requireWorkspaceRole(user, await workspaceOfDashboard(dashboardId), "editor");
  const body = patchSchema.parse(await readJson(req));
  const d = await prisma.dashboard.update({
    where: { id: dashboardId },
    data: { name: body.name, filters: body.filters as Prisma.InputJsonValue | undefined, updatedById: user.id },
  });
  return NextResponse.json(serializeDashboard(d));
});

export const DELETE = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { dashboardId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfDashboard(dashboardId), "editor");
  await prisma.$transaction(async (tx) => {
    const d = await tx.dashboard.delete({ where: { id: dashboardId } });
    await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "dashboard", entityId: dashboardId, action: "deleted", summary: `Deleted dashboard "${d.name}"` });
  });
  return new NextResponse(null, { status: 204 });
});

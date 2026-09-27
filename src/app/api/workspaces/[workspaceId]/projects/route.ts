import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, badRequest } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { dateOnlyToDate, projectInputSchema } from "@/lib/validation";
import { serializeProject } from "@/lib/serializers";

type P = { workspaceId: string };

export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "viewer");
  const projects = await prisma.project.findMany({ where: { workspaceId, deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  return NextResponse.json(projects.map(serializeProject));
});

export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "admin");
  const body = projectInputSchema.parse(await readJson(req));
  if (body.ownerId && !(await prisma.workspaceMember.findFirst({ where: { workspaceId, userId: body.ownerId } }))) throw badRequest("Owner must be a workspace member");
  const last = await prisma.project.aggregate({ where: { workspaceId }, _max: { sortOrder: true } });
  const project = await prisma.$transaction(async (tx) => {
    const p = await tx.project.create({
      data: {
        workspaceId,
        name: body.name,
        description: body.description ?? null,
        color: body.color,
        status: body.status,
        ownerId: body.ownerId ?? user.id,
        startDate: dateOnlyToDate(body.startDate),
        endDate: dateOnlyToDate(body.endDate),
        sortOrder: (last._max.sortOrder ?? 0) + 1,
        createdById: user.id,
        updatedById: user.id,
        // Starter views are UI configuration, not data.
        views: {
          create: [
            { name: "All Tasks", type: "grid", isDefault: true, sortOrder: 0, createdById: user.id },
            { name: "Board", type: "kanban", sortOrder: 1, createdById: user.id, config: { kanban: { groupFieldId: "sys_status" } } },
          ],
        },
      },
    });
    await logActivity(tx, { workspaceId, actorId: user.id, entityType: "project", entityId: p.id, action: "created", summary: `Created project "${p.name}"` });
    return p;
  });
  return NextResponse.json(serializeProject(project), { status: 201 });
});

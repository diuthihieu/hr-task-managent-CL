import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, badRequest } from "@/lib/authz";
import { uuid } from "@/lib/validation";
import type { CapturedThoughtRow } from "@/types";

type P = { workspaceId: string };

/** The caller's own open thoughts (captures are personal). */
export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "contributor");
  const thoughts = await prisma.capturedThought.findMany({
    where: { workspaceId, userId: user.id, status: "captured", project: { deletedAt: null } },
    include: { project: { select: { name: true } }, category: { select: { name: true, color: true } } },
    orderBy: { createdAt: "asc" },
  });
  const rows: CapturedThoughtRow[] = thoughts.map((t) => ({
    id: t.id,
    taskName: t.taskName,
    projectId: t.projectId,
    projectName: t.project.name,
    categoryId: t.categoryId,
    categoryLabel: t.category?.name ?? null,
    categoryColor: t.category?.color ?? null,
    estimatedDurationMinutes: t.estimatedDurationMinutes,
    plannedAt: t.plannedAt ? t.plannedAt.toISOString() : null,
    status: t.status,
    createdAt: t.createdAt.toISOString(),
  }));
  return NextResponse.json(rows);
});

const createSchema = z.object({
  taskName: z.string().trim().min(1).max(500),
  projectId: uuid,
  categoryId: uuid.nullable().optional(),
  estimatedDurationMinutes: z.number().int().min(0).max(60 * 24 * 30).nullable().optional(),
  plannedAt: z.string().max(40).nullable().optional(),
});

export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "contributor");
  const body = createSchema.parse(await readJson(req));
  if (!(await prisma.project.findFirst({ where: { id: body.projectId, workspaceId, deletedAt: null } }))) throw badRequest("Unknown project");
  if (body.categoryId && !(await prisma.category.findFirst({ where: { id: body.categoryId, workspaceId } }))) throw badRequest("Unknown category");
  const plannedAt = body.plannedAt ? new Date(body.plannedAt) : null;
  if (plannedAt && Number.isNaN(plannedAt.getTime())) throw badRequest("Invalid planned time");
  const t = await prisma.capturedThought.create({
    data: {
      workspaceId,
      userId: user.id,
      projectId: body.projectId,
      taskName: body.taskName,
      categoryId: body.categoryId ?? null,
      estimatedDurationMinutes: body.estimatedDurationMinutes ?? null,
      plannedAt,
    },
  });
  return NextResponse.json({ id: t.id }, { status: 201 });
});

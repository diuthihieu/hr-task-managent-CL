import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfKeyResult, badRequest } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { resolveObjectives, OBJECTIVE_INCLUDE } from "@/lib/okr-resolver";
import { uuid } from "@/lib/validation";

type P = { keyResultId: string };

/** Candidate tasks (not yet linked to this key result), searched by title in SQL. */
export const GET = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { keyResultId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfKeyResult(keyResultId), "viewer");
  const q = (new URL(req.url).searchParams.get("q") || "").trim();
  const tasks = await prisma.task.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      deletedAt: null,
      project: { deletedAt: null },
      OR: [{ keyResultId: null }, { keyResultId: { not: keyResultId } }],
      ...(q ? { title: { contains: q, mode: "insensitive" as const } } : {}),
    },
    select: { id: true, title: true, project: { select: { id: true, name: true } } },
    orderBy: { updatedAt: "desc" },
    take: 25,
  });
  return NextResponse.json(tasks.map((t) => ({ taskId: t.id, title: t.title, projectId: t.project.id, projectName: t.project.name })));
});

/** Link a task to this key result (a task contributes to at most one KR). */
export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { keyResultId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfKeyResult(keyResultId), "editor");
  const body = z.object({ taskId: uuid, weight: z.number().positive().max(1000).optional() }).parse(await readJson(req));
  const objective = await prisma.$transaction(async (tx) => {
    const task = await tx.task.findFirst({ where: { id: body.taskId, workspaceId: ctx.workspaceId, deletedAt: null } });
    if (!task) throw badRequest("Task not found in this workspace");
    await tx.task.update({ where: { id: task.id }, data: { keyResultId, okrWeight: body.weight ?? task.okrWeight, updatedById: user.id } });
    await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "task", entityId: task.id, action: "updated", changes: { keyResult: { from: task.keyResultId, to: keyResultId } } });
    const kr = await tx.keyResult.findUniqueOrThrow({ where: { id: keyResultId }, select: { objectiveId: true } });
    return tx.objective.findUniqueOrThrow({ where: { id: kr.objectiveId }, include: OBJECTIVE_INCLUDE });
  });
  return NextResponse.json(resolveObjectives([objective])[0], { status: 201 });
});

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, workspaceOfKeyResult, notFound, hiddenProjectIds } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { resolveObjectives, OBJECTIVE_INCLUDE } from "@/lib/okr-resolver";

type P = { keyResultId: string; taskId: string };

export const DELETE = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { keyResultId, taskId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfKeyResult(keyResultId), "editor");
  const objective = await prisma.$transaction(async (tx) => {
    const task = await tx.task.findFirst({ where: { id: taskId, keyResultId } });
    if (!task) throw notFound("Linked task");
    await tx.task.update({ where: { id: taskId }, data: { keyResultId: null, objectiveId: null, updatedById: user.id } });
    await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "task", entityId: taskId, action: "updated", changes: { keyResult: { from: keyResultId, to: null } } });
    const kr = await tx.keyResult.findUniqueOrThrow({ where: { id: keyResultId }, select: { objectiveId: true } });
    return tx.objective.findUniqueOrThrow({ where: { id: kr.objectiveId }, include: OBJECTIVE_INCLUDE });
  });
  return NextResponse.json(resolveObjectives([objective], await hiddenProjectIds(user))[0]);
});

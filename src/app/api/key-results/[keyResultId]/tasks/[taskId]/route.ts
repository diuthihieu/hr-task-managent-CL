import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, workspaceOfKeyResult, notFound, hiddenProjectIds, visibleProjectWhere, assertCanEditTask } from "@/lib/authz";
import { assertProjectCap } from "@/lib/project-permissions";
import { logActivity } from "@/lib/activity";
import { resolveObjectives, OBJECTIVE_INCLUDE } from "@/lib/okr-resolver";

type P = { keyResultId: string; taskId: string };

export const DELETE = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { keyResultId, taskId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfKeyResult(keyResultId), "editor");
  if (ctx.projectId) await assertProjectCap(ctx, ctx.projectId, "okr.manage");
  // A task of a hidden project answers like one that isn't linked.
  const linked = await prisma.task.findFirst({ where: { id: taskId, keyResultId, deletedAt: null, project: { deletedAt: null, ...visibleProjectWhere(user) } }, select: { id: true } });
  if (!linked) throw notFound("Linked task");
  await assertCanEditTask(ctx, taskId);
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

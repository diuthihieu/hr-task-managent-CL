import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfKeyResult, hiddenProjectIds } from "@/lib/authz";
import { logActivity, diff } from "@/lib/activity";
import { resolveObjectives, OBJECTIVE_INCLUDE } from "@/lib/okr-resolver";
import { assertObjectiveRefs } from "@/lib/okr-write";
import { keyResultSchema } from "@/lib/validation";

type P = { keyResultId: string };

export const PATCH = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { keyResultId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfKeyResult(keyResultId), "editor");
  const body = keyResultSchema.partial().parse(await readJson(req));
  const objective = await prisma.$transaction(async (tx) => {
    await assertObjectiveRefs(tx, ctx.workspaceId, { ownerId: body.ownerId });
    const before = await tx.keyResult.findUniqueOrThrow({ where: { id: keyResultId } });
    const { order, dueDate, ...rest } = body;
    const after = await tx.keyResult.update({
      where: { id: keyResultId },
      data: { ...rest, ...(dueDate !== undefined ? { dueDate: dueDate ? new Date(`${dueDate}T00:00:00Z`) : null } : {}), sortOrder: order, updatedById: user.id },
    });
    const changes = diff(before, after, ["title", "ownerId", "type", "startValue", "targetValue", "currentValue", "unit", "weight", "manualProgress", "status", "confidence", "dueDate"]);
    if (changes) await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "key_result", entityId: keyResultId, action: "updated", changes });
    return tx.objective.findUniqueOrThrow({ where: { id: after.objectiveId }, include: OBJECTIVE_INCLUDE });
  });
  return NextResponse.json(resolveObjectives([objective], await hiddenProjectIds(user))[0]);
});

export const DELETE = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { keyResultId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfKeyResult(keyResultId), "editor");
  const objective = await prisma.$transaction(async (tx) => {
    const kr = await tx.keyResult.update({ where: { id: keyResultId }, data: { deletedAt: new Date(), updatedById: user.id } });
    // Linked tasks move up to the objective itself; cascaded objectives lose the alignment.
    await tx.task.updateMany({ where: { keyResultId }, data: { keyResultId: null } });
    await tx.objective.updateMany({ where: { parentKeyResultId: keyResultId }, data: { parentKeyResultId: null, parentObjectiveId: null } });
    await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "key_result", entityId: keyResultId, action: "deleted", summary: `Deleted key result "${kr.title}"` });
    return tx.objective.findUniqueOrThrow({ where: { id: kr.objectiveId }, include: OBJECTIVE_INCLUDE });
  });
  return NextResponse.json(resolveObjectives([objective], await hiddenProjectIds(user))[0]);
});

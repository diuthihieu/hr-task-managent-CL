import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfObjective, hiddenProjectIds } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { resolveObjectives, OBJECTIVE_INCLUDE } from "@/lib/okr-resolver";
import { assertObjectiveRefs } from "@/lib/okr-write";
import { keyResultSchema } from "@/lib/validation";

type P = { objectiveId: string };

export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { objectiveId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfObjective(objectiveId), "editor");
  const body = keyResultSchema.parse(await readJson(req));
  const objective = await prisma.$transaction(async (tx) => {
    await assertObjectiveRefs(tx, ctx.workspaceId, { ownerId: body.ownerId });
    const count = await tx.keyResult.count({ where: { objectiveId, deletedAt: null } });
    const kr = await tx.keyResult.create({
      data: {
        objectiveId,
        title: body.title,
        ownerId: body.ownerId ?? null,
        type: body.type,
        startValue: body.startValue,
        targetValue: body.targetValue,
        currentValue: body.currentValue,
        unit: body.unit ?? null,
        weight: body.weight,
        manualProgress: body.manualProgress ?? null,
        status: body.status,
        sortOrder: count,
        createdById: user.id,
        updatedById: user.id,
      },
    });
    await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "key_result", entityId: kr.id, action: "created", summary: `Added key result "${kr.title}"` });
    return tx.objective.findUniqueOrThrow({ where: { id: objectiveId }, include: OBJECTIVE_INCLUDE });
  });
  return NextResponse.json(resolveObjectives([objective], await hiddenProjectIds(user))[0], { status: 201 });
});

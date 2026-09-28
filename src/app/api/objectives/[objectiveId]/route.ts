import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfObjective, hiddenProjectIds } from "@/lib/authz";
import { logActivity, diff } from "@/lib/activity";
import { resolveObjectives, pruneToMyBranch, myTaskIdsIn, OBJECTIVE_INCLUDE } from "@/lib/okr-resolver";
import { assertObjectiveRefs, parentObjectiveFor } from "@/lib/okr-write";
import { objectiveSchema, dateOnlyToDate, lenientDateOnly } from "@/lib/validation";

type P = { objectiveId: string };

export const GET = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { objectiveId } = await params;
  await requireWorkspaceRole(user, await workspaceOfObjective(objectiveId), "viewer");
  const o = await prisma.objective.findUniqueOrThrow({ where: { id: objectiveId }, include: OBJECTIVE_INCLUDE });
  const row = resolveObjectives([o], await hiddenProjectIds(user))[0];
  // ?mine=1 (opened from "My OKRs"): only the viewer's own branch, when they have one.
  if (new URL(req.url).searchParams.get("mine") === "1") {
    const [mine] = pruneToMyBranch([row], user.id, await myTaskIdsIn(user.id, [objectiveId]));
    if (mine) return NextResponse.json(mine);
  }
  return NextResponse.json(row);
});

export const PATCH = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { objectiveId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfObjective(objectiveId), "editor");
  const raw = await readJson<Record<string, unknown>>(req);
  const body = objectiveSchema.partial().parse({ ...raw, startDate: lenientDateOnly(raw.startDate), endDate: lenientDateOnly(raw.endDate) });
  const objective = await prisma.$transaction(async (tx) => {
    await assertObjectiveRefs(tx, ctx.workspaceId, body, objectiveId);
    const before = await tx.objective.findUniqueOrThrow({ where: { id: objectiveId } });
    if (body.contributorIds) {
      await tx.objectiveContributor.deleteMany({ where: { objectiveId } });
      if (body.contributorIds.length) await tx.objectiveContributor.createMany({ data: body.contributorIds.map((userId) => ({ objectiveId, userId })) });
    }
    const after = await tx.objective.update({
      where: { id: objectiveId },
      data: {
        title: body.title,
        description: body.description,
        teamId: body.teamId,
        parentObjectiveId: body.parentKeyResultId !== undefined ? await parentObjectiveFor(tx, body.parentKeyResultId) : body.parentObjectiveId,
        parentKeyResultId: body.parentKeyResultId,
        projectId: body.projectId,
        ownerId: body.ownerId,
        cycleType: body.cycleType,
        cycleLabel: body.cycleLabel,
        startDate: dateOnlyToDate(body.startDate),
        endDate: dateOnlyToDate(body.endDate),
        status: body.status,
        confidence: body.confidence,
        priority: body.priority,
        updatedById: user.id,
      },
      include: OBJECTIVE_INCLUDE,
    });
    const changes = diff(before, after, ["title", "description", "teamId", "ownerId", "projectId", "parentKeyResultId", "cycleType", "cycleLabel", "startDate", "endDate", "status", "confidence", "priority"]);
    if (changes) await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "objective", entityId: objectiveId, action: "updated", changes });
    return after;
  });
  return NextResponse.json(resolveObjectives([objective], await hiddenProjectIds(user))[0]);
});

/** Soft delete (objective + its key results). Linked tasks stay and are unlinked. */
export const DELETE = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { objectiveId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfObjective(objectiveId), "editor");
  await prisma.$transaction(async (tx) => {
    const now = new Date();
    const o = await tx.objective.update({ where: { id: objectiveId }, data: { deletedAt: now, updatedById: user.id } });
    // Unlink tasks so they don't point at a hidden key result.
    await tx.task.updateMany({ where: { OR: [{ objectiveId }, { keyResult: { objectiveId } }] }, data: { keyResultId: null, objectiveId: null } });
    // Objectives cascaded from its key results stay, but lose the alignment.
    await tx.objective.updateMany({ where: { parentKeyResult: { objectiveId } }, data: { parentKeyResultId: null, parentObjectiveId: null } });
    await tx.keyResult.updateMany({ where: { objectiveId, deletedAt: null }, data: { deletedAt: now } });
    await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "objective", entityId: objectiveId, action: "deleted", summary: `Deleted objective "${o.title}"` });
  });
  return new NextResponse(null, { status: 204 });
});

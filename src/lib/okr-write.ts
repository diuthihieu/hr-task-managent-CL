import type { Prisma } from "@prisma/client";
import { badRequest } from "./http-errors";

type Tx = Prisma.TransactionClient;

/** Objectives the actor can see: workspace-level ones, and those of projects not hidden from them. */
export async function objectiveVisibility(tx: Tx, actorId: string | null | undefined): Promise<Prisma.ObjectiveWhereInput> {
  if (!actorId) return {};
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { systemRole: true } });
  if (actor?.systemRole === "ADMIN" && process.env.ADMIN_SUPPORT_ACCESS === "1") return {};
  return { OR: [{ projectId: null }, { project: { hiddenMembers: { none: { userId: actorId } } } }] };
}

/**
 * Owner, contributors and team must belong to the objective's workspace; the
 * parent objective / key result and the project must be ones the actor can see.
 */
export async function assertObjectiveRefs(tx: Tx, workspaceId: string, refs: { ownerId?: string | null; contributorIds?: string[]; parentObjectiveId?: string | null; parentKeyResultId?: string | null; projectId?: string | null }, selfId?: string, actorId?: string) {
  const visible = await objectiveVisibility(tx, actorId);
  const userIds = [...new Set([...(refs.ownerId ? [refs.ownerId] : []), ...(refs.contributorIds ?? [])])];
  if (userIds.length) {
    const n = await tx.workspaceMember.count({ where: { workspaceId, userId: { in: userIds } } });
    if (n !== userIds.length) throw badRequest("Owner and contributors must be workspace members");
  }
  if (refs.parentObjectiveId) {
    if (refs.parentObjectiveId === selfId) throw badRequest("An objective cannot be its own parent");
    if (!(await tx.objective.findFirst({ where: { id: refs.parentObjectiveId, workspaceId, deletedAt: null, ...visible } }))) throw badRequest("Unknown parent objective");
  }
  if (refs.projectId && !(await tx.project.findFirst({ where: { id: refs.projectId, workspaceId, deletedAt: null, ...(actorId && Object.keys(visible).length ? { hiddenMembers: { none: { userId: actorId } } } : {}) } }))) throw badRequest("Unknown project");
  if (refs.parentKeyResultId) {
    const kr = await tx.keyResult.findFirst({ where: { id: refs.parentKeyResultId, deletedAt: null, objective: { workspaceId, deletedAt: null, ...visible } }, select: { objectiveId: true } });
    if (!kr) throw badRequest("Unknown parent key result");
    if (kr.objectiveId === selfId) throw badRequest("An objective cannot align to its own key result");
    if (selfId) await assertNoCascadeCycle(tx, selfId, kr.objectiveId);
  }
}

/** Walks up from `startObjectiveId` through parent key results / parent objectives; rejects if it reaches `selfId`. */
async function assertNoCascadeCycle(tx: Tx, selfId: string, startObjectiveId: string) {
  let cursor: string | null = startObjectiveId;
  for (let depth = 0; cursor && depth < 50; depth++) {
    if (cursor === selfId) throw badRequest("This alignment would create a loop between objectives");
    const row: { parentObjectiveId: string | null; parentKeyResult: { objectiveId: string } | null } | null = await tx.objective.findUnique({
      where: { id: cursor },
      select: { parentObjectiveId: true, parentKeyResult: { select: { objectiveId: true } } },
    });
    cursor = row?.parentKeyResult?.objectiveId ?? row?.parentObjectiveId ?? null;
  }
}

/** When an objective aligns to a parent key result, its parent objective is that key result's objective. */
export async function parentObjectiveFor(tx: Tx, parentKeyResultId: string | null | undefined): Promise<string | null | undefined> {
  if (parentKeyResultId === undefined) return undefined;
  if (parentKeyResultId === null) return null;
  const kr = await tx.keyResult.findUnique({ where: { id: parentKeyResultId }, select: { objectiveId: true } });
  return kr?.objectiveId ?? null;
}

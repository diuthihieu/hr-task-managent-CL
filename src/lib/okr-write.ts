import type { Prisma } from "@prisma/client";
import { badRequest } from "./http-errors";

type Tx = Prisma.TransactionClient;

/** Owner, contributors and team must belong to the objective's workspace. */
export async function assertObjectiveRefs(tx: Tx, workspaceId: string, refs: { ownerId?: string | null; contributorIds?: string[]; teamId?: string | null; parentObjectiveId?: string | null }, selfId?: string) {
  const userIds = [...new Set([...(refs.ownerId ? [refs.ownerId] : []), ...(refs.contributorIds ?? [])])];
  if (userIds.length) {
    const n = await tx.workspaceMember.count({ where: { workspaceId, userId: { in: userIds } } });
    if (n !== userIds.length) throw badRequest("Owner and contributors must be workspace members");
  }
  if (refs.teamId && !(await tx.team.findFirst({ where: { id: refs.teamId, workspaceId } }))) throw badRequest("Unknown team");
  if (refs.parentObjectiveId) {
    if (refs.parentObjectiveId === selfId) throw badRequest("An objective cannot be its own parent");
    if (!(await tx.objective.findFirst({ where: { id: refs.parentObjectiveId, workspaceId, deletedAt: null } }))) throw badRequest("Unknown parent objective");
  }
}

import "server-only";
import type { Prisma, WorkspaceRole } from "@prisma/client";
import { badRequest } from "./authz";

type Tx = Prisma.TransactionClient;

export const ROLE_RANK: Record<WorkspaceRole, number> = { viewer: 0, contributor: 1, editor: 2, admin: 3, owner: 4 };

/** Checked inside the change's transaction under a per-workspace lock, so concurrent removals can't drop the last owner. */
export async function assertKeepsAnOwner(tx: Tx, workspaceId: string, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"ws-owners:" + workspaceId}))`;
  const others = await tx.workspaceMember.count({ where: { workspaceId, role: "owner", userId: { not: userId } } });
  if (others === 0) throw badRequest("A workspace needs at least one owner");
}

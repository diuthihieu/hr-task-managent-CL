import "server-only";
import type { Prisma, WorkspaceRole } from "@prisma/client";
import { badRequest, forbidden, notFound } from "./authz";
import { logActivity } from "./activity";

type Tx = Prisma.TransactionClient;

export const ROLE_RANK: Record<WorkspaceRole, number> = { viewer: 0, contributor: 1, editor: 2, admin: 3, owner: 4 };

/** Checked inside the change's transaction under a per-workspace lock, so concurrent removals can't drop the last owner. */
export async function assertKeepsAnOwner(tx: Tx, workspaceId: string, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"ws-owners:" + workspaceId}))`;
  const others = await tx.workspaceMember.count({ where: { workspaceId, role: "owner", userId: { not: userId } } });
  if (others === 0) throw badRequest("A workspace needs at least one owner");
}

/**
 * Change one member's role (not the owner's, and never to owner: a workspace
 * has exactly one owner, moved only with Transfer ownership). Logs it and
 * tells the person, who may decline a promotion.
 */
export async function applyRoleChange(tx: Tx, o: { workspaceId: string; actorId: string; userId: string; role: WorkspaceRole }) {
  const target = await tx.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: o.workspaceId, userId: o.userId } } });
  if (!target) throw notFound("Member");
  if (o.role === "owner" || target.role === "owner") throw forbidden("A workspace has exactly one owner - use Transfer ownership");
  if (target.role === o.role) return target;
  const m = await tx.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: o.workspaceId, userId: o.userId } }, data: { role: o.role } });
  await logActivity(tx, { workspaceId: o.workspaceId, actorId: o.actorId, entityType: "member", entityId: o.userId, action: "role_changed", changes: { role: { from: target.role, to: o.role } } });
  if (o.userId !== o.actorId) {
    const ws = await tx.workspace.findUniqueOrThrow({ where: { id: o.workspaceId }, select: { name: true, slug: true } });
    await tx.notification.create({ data: { userId: o.userId, workspaceId: o.workspaceId, actorId: o.actorId, type: "role_changed", title: ws.name, data: { from: target.role, to: o.role }, link: `/w/${ws.slug}` } });
  }
  return m;
}

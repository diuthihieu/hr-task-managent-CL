import "server-only";
import { randomBytes } from "crypto";
import type { Prisma, WorkspaceRole } from "@prisma/client";
import { prisma } from "./prisma";
import { logActivity } from "./activity";
import { badRequest, forbidden, notFound } from "./http-errors";

type Tx = Prisma.TransactionClient;

export const INVITE_TTL_DAYS = 14;
/** Roles a join link can grant. Admins and owners are only ever made in settings. */
export const LINK_ROLES = ["editor", "contributor", "viewer"] as const;

export const newToken = () => randomBytes(24).toString("base64url");
export const inviteUrl = (origin: string, token: string) => `${origin}/invite/${token}`;
const inviteDedupe = (id: string) => `invite:${id}`;

const livePending = (now = new Date()) => ({ status: "pending" as const, expiresAt: { gt: now }, workspace: { deletedAt: null } });

/**
 * Invite people by email. Nobody joins until they accept. Existing accounts
 * get an Action Center notification now; others see the invitation as soon as
 * they sign up with that address. Re-inviting refreshes a pending invitation.
 */
export async function createInvitations(
  tx: Tx,
  opts: { workspaceId: string; emails: string[]; role: WorkspaceRole; invitedById: string; message?: string | null }
) {
  const ws = await tx.workspace.findUniqueOrThrow({ where: { id: opts.workspaceId }, select: { name: true, slug: true } });
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86400_000);
  const results: { email: string; status: "invited" | "already_member" | "reinvited"; invitationId?: string; token?: string; hasAccount: boolean }[] = [];
  for (const raw of [...new Set(opts.emails.map((e) => e.trim().toLowerCase()))]) {
    const account = await tx.user.findFirst({ where: { email: raw, deletedAt: null }, select: { id: true, isActive: true } });
    if (account && (await tx.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: opts.workspaceId, userId: account.id } } }))) {
      results.push({ email: raw, status: "already_member", hasAccount: true });
      continue;
    }
    const existing = await tx.workspaceInvitation.findFirst({ where: { workspaceId: opts.workspaceId, email: raw, status: "pending" } });
    const inv = existing
      ? await tx.workspaceInvitation.update({ where: { id: existing.id }, data: { role: opts.role, expiresAt, invitedById: opts.invitedById, message: opts.message ?? existing.message, invitedUserId: account?.id ?? null } })
      : await tx.workspaceInvitation.create({
          data: { workspaceId: opts.workspaceId, email: raw, invitedUserId: account?.id ?? null, role: opts.role, token: newToken(), invitedById: opts.invitedById, message: opts.message ?? null, expiresAt },
        });
    if (account?.isActive) await notifyInvitee(tx, inv.id, account.id);
    await logActivity(tx, { workspaceId: opts.workspaceId, actorId: opts.invitedById, entityType: "member", entityId: inv.id, action: "created", summary: `Invited ${raw} as ${opts.role} to ${ws.name}` });
    results.push({ email: raw, status: existing ? "reinvited" : "invited", invitationId: inv.id, token: inv.token, hasAccount: !!account });
  }
  return results;
}

async function notifyInvitee(db: Tx | typeof prisma, invitationId: string, userId: string) {
  const inv = await db.workspaceInvitation.findUniqueOrThrow({ where: { id: invitationId }, select: { workspaceId: true, role: true, token: true, invitedById: true, workspace: { select: { name: true } } } });
  await db.notification.createMany({
    data: [
      {
        userId,
        workspaceId: inv.workspaceId,
        actorId: inv.invitedById,
        type: "workspace_invite",
        title: inv.workspace.name,
        data: { invitationId, role: inv.role },
        link: `/invite/${inv.token}`,
        dedupeKey: inviteDedupe(invitationId),
      },
    ],
    skipDuplicates: true,
  });
}

/** Links invitations sent to this user's email before they had an account, and makes sure each has a notification. */
export async function syncInvitations(user: { id: string; email: string }) {
  const email = user.email.toLowerCase();
  const pending = await prisma.workspaceInvitation.findMany({ where: { ...livePending(), OR: [{ invitedUserId: user.id }, { invitedUserId: null, email }] }, select: { id: true, invitedUserId: true } });
  for (const inv of pending) {
    if (!inv.invitedUserId) await prisma.workspaceInvitation.update({ where: { id: inv.id }, data: { invitedUserId: user.id } });
    await notifyInvitee(prisma, inv.id, user.id);
  }
}

/** The user's open invitations (for the workspace chooser). */
export async function pendingInvitationsFor(user: { id: string; email: string }) {
  const rows = await prisma.workspaceInvitation.findMany({
    where: { ...livePending(), OR: [{ invitedUserId: user.id }, { email: user.email.toLowerCase() }] },
    orderBy: { createdAt: "desc" },
    select: { id: true, token: true, role: true, message: true, createdAt: true, workspace: { select: { name: true, _count: { select: { members: true } } } }, invitedBy: { select: { name: true } } },
  });
  return rows.map((r) => ({ id: r.id, token: r.token, role: r.role, message: r.message, createdAt: r.createdAt.toISOString(), workspaceName: r.workspace.name, memberCount: r.workspace._count.members, invitedBy: r.invitedBy?.name ?? null }));
}

/** What an /invite/<token> link points at: a personal invitation or a workspace's join link. */
export async function resolveInviteToken(token: string) {
  const now = new Date();
  const inv = await prisma.workspaceInvitation.findUnique({
    where: { token },
    include: { workspace: { select: { id: true, name: true, slug: true, deletedAt: true, _count: { select: { members: true } } } }, invitedBy: { select: { name: true } } },
  });
  if (inv) {
    const state = inv.workspace.deletedAt ? "gone" : inv.status !== "pending" ? inv.status : inv.expiresAt <= now ? "expired" : "pending";
    return { kind: "invitation" as const, id: inv.id, state, email: inv.email, role: inv.role, message: inv.message, invitedBy: inv.invitedBy?.name ?? null, workspace: inv.workspace };
  }
  const link = await prisma.workspaceInviteLink.findUnique({
    where: { token },
    include: { workspace: { select: { id: true, name: true, slug: true, deletedAt: true, _count: { select: { members: true } } } }, createdBy: { select: { name: true } } },
  });
  if (!link) return null;
  const state = link.workspace.deletedAt ? "gone" : link.revokedAt ? "revoked" : link.expiresAt && link.expiresAt <= now ? "expired" : "pending";
  return { kind: "link" as const, id: link.id, state, email: null, role: link.role, message: null, invitedBy: link.createdBy?.name ?? null, workspace: link.workspace };
}

/**
 * Accept or decline. A personal invitation is only for the account with that
 * email; a join link works for anyone signed in. Accepting creates the membership.
 */
export async function respondToInvite(user: { id: string; email: string; name: string }, token: string, decision: "accept" | "decline") {
  const target = await resolveInviteToken(token);
  if (!target) throw notFound("Invitation");
  if (target.kind === "invitation" && target.email.toLowerCase() !== user.email.toLowerCase()) throw forbidden(`This invitation was sent to ${target.email}. Sign in with that email to accept it.`);
  const already = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: target.workspace.id, userId: user.id } } });
  if (already) return { joined: true, slug: target.workspace.slug, alreadyMember: true };
  if (target.state !== "pending") throw badRequest(target.state === "expired" ? "This invitation has expired - ask for a new one" : "This invitation is no longer valid");
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    if (target.kind === "invitation") {
      await tx.workspaceInvitation.update({ where: { id: target.id }, data: { status: decision === "accept" ? "accepted" : "declined", respondedAt: now, invitedUserId: user.id } });
      await tx.notification.updateMany({ where: { userId: user.id, dedupeKey: inviteDedupe(target.id) }, data: { actionedAt: now, readAt: now } });
    }
    if (decision === "decline") {
      if (target.kind === "invitation") await notifyInviter(tx, target.id, user, "declined");
      return { joined: false, slug: null, alreadyMember: false };
    }
    await tx.workspaceMember.create({ data: { workspaceId: target.workspace.id, userId: user.id, role: target.role, createdById: user.id } });
    // Any other pending invitation to the same workspace is settled by joining.
    await tx.workspaceInvitation.updateMany({ where: { workspaceId: target.workspace.id, status: "pending", OR: [{ invitedUserId: user.id }, { email: user.email.toLowerCase() }] }, data: { status: "accepted", respondedAt: now } });
    if (target.kind === "link") await tx.workspaceInviteLink.update({ where: { id: target.id }, data: { useCount: { increment: 1 } } });
    else await notifyInviter(tx, target.id, user, "accepted");
    await logActivity(tx, { workspaceId: target.workspace.id, actorId: user.id, entityType: "member", entityId: user.id, action: "created", summary: `${user.name} joined as ${target.role} (${target.kind === "link" ? "invite link" : "invitation"})` });
    return { joined: true, slug: target.workspace.slug, alreadyMember: false };
  });
}

async function notifyInviter(tx: Tx, invitationId: string, invitee: { id: string; name: string }, decision: "accepted" | "declined") {
  const inv = await tx.workspaceInvitation.findUniqueOrThrow({ where: { id: invitationId }, select: { invitedById: true, workspaceId: true, email: true, workspace: { select: { name: true, slug: true } } } });
  if (!inv.invitedById || inv.invitedById === invitee.id) return;
  await tx.notification.create({
    data: {
      userId: inv.invitedById,
      workspaceId: inv.workspaceId,
      actorId: invitee.id,
      type: "workspace_invite_result",
      title: inv.workspace.name,
      body: inv.email,
      data: { invitationId, decision },
      link: `/w/${inv.workspace.slug}/settings?section=members`,
    },
  });
}

/** The workspace's live join link, creating or replacing it on request. */
export async function liveInviteLink(workspaceId: string) {
  return prisma.workspaceInviteLink.findFirst({ where: { workspaceId, revokedAt: null } });
}

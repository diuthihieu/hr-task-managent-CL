import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { LINK_ROLES, inviteUrl, liveInviteLink, newToken } from "@/lib/invitations";

type P = { workspaceId: string };

function view(req: Request, link: { token: string; role: string; createdAt: Date; useCount: number; expiresAt: Date | null } | null) {
  if (!link) return { enabled: false, url: null, role: "contributor", uses: 0, createdAt: null, expiresAt: null };
  return { enabled: true, url: inviteUrl(new URL(req.url).origin, link.token), role: link.role, uses: link.useCount, createdAt: link.createdAt.toISOString(), expiresAt: link.expiresAt?.toISOString() ?? null };
}

/** The workspace's join link (admins). */
export const GET = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "admin");
  return NextResponse.json(view(req, await liveInviteLink(workspaceId)));
});

const schema = z.object({
  role: z.enum(LINK_ROLES).optional(),
  /** Replace the link: the old one stops working. */
  regenerate: z.boolean().optional(),
  expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
});

/** Turn the link on, change its role or expiry, or replace it. */
export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "admin");
  const body = schema.parse(await readJson(req));
  const expiresAt = body.expiresInDays === undefined ? undefined : body.expiresInDays === null ? null : new Date(Date.now() + body.expiresInDays * 86400_000);
  const link = await prisma.$transaction(async (tx) => {
    const current = await tx.workspaceInviteLink.findFirst({ where: { workspaceId, revokedAt: null } });
    if (current && !body.regenerate) return tx.workspaceInviteLink.update({ where: { id: current.id }, data: { role: body.role, expiresAt } });
    if (current) await tx.workspaceInviteLink.update({ where: { id: current.id }, data: { revokedAt: new Date() } });
    const created = await tx.workspaceInviteLink.create({ data: { workspaceId, token: newToken(), role: body.role ?? current?.role ?? "contributor", createdById: user.id, expiresAt: expiresAt ?? current?.expiresAt ?? null } });
    await logActivity(tx, { workspaceId, actorId: user.id, entityType: "member", entityId: created.id, action: "created", summary: current ? "Replaced the workspace invite link" : "Turned on the workspace invite link" });
    return created;
  });
  return NextResponse.json(view(req, link));
});

/** Turn the link off. */
export const DELETE = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "admin");
  const res = await prisma.workspaceInviteLink.updateMany({ where: { workspaceId, revokedAt: null }, data: { revokedAt: new Date() } });
  if (res.count) await prisma.$transaction((tx) => logActivity(tx, { workspaceId, actorId: user.id, entityType: "member", entityId: workspaceId, action: "deleted", summary: "Turned off the workspace invite link" }));
  return NextResponse.json(view(req, null));
});

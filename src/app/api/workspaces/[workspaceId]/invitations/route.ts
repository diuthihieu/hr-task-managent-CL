import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route } from "@/lib/authz";
import { inviteUrl } from "@/lib/invitations";

type P = { workspaceId: string };

/** Pending invitations of the workspace (admins), with each personal link. */
export const GET = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "admin");
  const rows = await prisma.workspaceInvitation.findMany({
    where: { workspaceId, status: "pending" },
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, role: true, token: true, createdAt: true, expiresAt: true, invitedUserId: true, invitedBy: { select: { name: true } } },
  });
  const origin = new URL(req.url).origin;
  const now = new Date();
  return NextResponse.json(
    rows.map((r) => ({ id: r.id, email: r.email, role: r.role, url: inviteUrl(origin, r.token), createdAt: r.createdAt.toISOString(), expiresAt: r.expiresAt.toISOString(), expired: r.expiresAt <= now, hasAccount: !!r.invitedUserId, invitedBy: r.invitedBy?.name ?? null }))
  );
});

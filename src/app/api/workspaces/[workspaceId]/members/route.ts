import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, badRequest } from "@/lib/authz";
import { createInvitations, inviteUrl } from "@/lib/invitations";
import { emailSchema, workspaceRoleSchema } from "@/lib/validation";

type P = { workspaceId: string };

/** Default: active members for pickers. `?withRoles=1`: everyone incl. inactive, with roles (settings). */
export const GET = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "viewer");
  const withRoles = new URL(req.url).searchParams.get("withRoles") === "1";
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId, user: withRoles ? { deletedAt: null } : { isActive: true, deletedAt: null } },
    include: { user: { select: { id: true, name: true, email: true, avatarColor: true, isActive: true } } },
    orderBy: { user: { name: "asc" } },
  });
  if (withRoles) return NextResponse.json(members.map((m) => ({ ...m.user, role: m.role })));
  return NextResponse.json(members.map((m) => ({ id: m.user.id, name: m.user.name, email: m.user.email, avatarColor: m.user.avatarColor })));
});

const inviteSchema = z
  .object({
    email: emailSchema.optional(),
    emails: z.array(emailSchema).max(50).optional(),
    role: workspaceRoleSchema.default("editor"),
    message: z.string().trim().max(500).nullable().optional(),
  })
  .refine((b) => b.email || b.emails?.length, "Enter at least one email");

/**
 * Invite people by email. Nobody is added directly: each person gets an
 * invitation (Action Center, or on sign-up for new addresses) and joins only
 * after accepting. Returns a personal link per invitation that can also be sent by hand.
 */
export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "admin");
  const body = inviteSchema.parse(await readJson(req));
  if (body.role === "owner") throw badRequest("Invite them first; an owner can make them an owner after they join");
  const emails = [...(body.emails ?? []), ...(body.email ? [body.email] : [])];
  const results = await prisma.$transaction((tx) => createInvitations(tx, { workspaceId, emails, role: body.role, invitedById: user.id, message: body.message ?? null }));
  const origin = new URL(req.url).origin;
  return NextResponse.json({ invitations: results.map((r) => ({ ...r, token: undefined, url: r.token ? inviteUrl(origin, r.token) : null })) }, { status: 201 });
});

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, badRequest, forbidden } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { emailSchema, uuid, workspaceRoleSchema } from "@/lib/validation";

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

const addSchema = z.object({ email: emailSchema.optional(), userId: uuid.optional(), role: workspaceRoleSchema.default("editor") });

/** Add an *existing* account to the workspace. New accounts are created by a system admin. */
export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  const ctx = await requireWorkspaceRole(user, workspaceId, "admin");
  const body = addSchema.parse(await readJson(req));
  if (body.role === "owner" && ctx.role !== "owner") throw forbidden("Only owners can add owners");
  const target = await prisma.user.findFirst({
    where: { deletedAt: null, ...(body.userId ? { id: body.userId } : { email: body.email ?? "" }) },
  });
  if (!target) throw badRequest("No account with that email. Ask a system admin to create it first.");
  if (await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: target.id } } })) throw badRequest("Already a member");
  const member = await prisma.$transaction(async (tx) => {
    const m = await tx.workspaceMember.create({
      data: { workspaceId, userId: target.id, role: body.role, createdById: user.id },
      include: { user: { select: { id: true, name: true, email: true, avatarColor: true, isActive: true } } },
    });
    await logActivity(tx, { workspaceId, actorId: user.id, entityType: "member", entityId: target.id, action: "created", summary: `Added ${target.name} as ${body.role}` });
    return m;
  });
  return NextResponse.json({ ...member.user, role: member.role }, { status: 201 });
});


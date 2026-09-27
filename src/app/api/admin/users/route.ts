import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, route, readJson, badRequest } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { assertPasswordPolicy, generateTemporaryPassword, hashPassword, randomAvatarColor } from "@/lib/passwords";
import { emailSchema, nameSchema, uuid, workspaceRoleSchema } from "@/lib/validation";

export const GET = route(async () => {
  await requireAdmin();
  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: {
      id: true,
      email: true,
      name: true,
      systemRole: true,
      isActive: true,
      mustChangePassword: true,
      lastLoginAt: true,
      createdAt: true,
      memberships: { where: { workspace: { deletedAt: null } }, select: { role: true, workspace: { select: { id: true, name: true } } } },
    },
  });
  return NextResponse.json(
    users.map(({ memberships, ...u }) => ({ ...u, workspaces: memberships.map((m) => ({ id: m.workspace.id, name: m.workspace.name, role: m.role })) }))
  );
});

const createSchema = z.object({
  email: emailSchema,
  name: nameSchema,
  systemRole: z.enum(["ADMIN", "MEMBER"]).default("MEMBER"),
  /** Optional: admin-chosen initial password. Otherwise a temporary one is generated and returned once. */
  password: z.string().optional(),
  workspaceId: uuid.optional(),
  workspaceRole: workspaceRoleSchema.default("editor"),
});

export const POST = route(async (req) => {
  const admin = await requireAdmin();
  const body = createSchema.parse(await readJson(req));
  const password = body.password ? assertPasswordPolicy(body.password) : generateTemporaryPassword();
  if (await prisma.user.findUnique({ where: { email: body.email }, select: { id: true } })) {
    throw badRequest("An account with this email already exists");
  }
  if (body.workspaceId && !(await prisma.workspace.findFirst({ where: { id: body.workspaceId, deletedAt: null }, select: { id: true } }))) {
    throw badRequest("Workspace not found");
  }
  const passwordHash = await hashPassword(password);
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: body.email,
        name: body.name,
        systemRole: body.systemRole,
        passwordHash,
        avatarColor: randomAvatarColor(),
        mustChangePassword: true,
        createdById: admin.id,
        updatedById: admin.id,
      },
    });
    await logActivity(tx, { workspaceId: null, actorId: admin.id, entityType: "user", entityId: created.id, action: "created", summary: `Created account ${created.email} (${created.systemRole})` });
    if (body.workspaceId) {
      await tx.workspaceMember.create({ data: { workspaceId: body.workspaceId, userId: created.id, role: body.workspaceRole, createdById: admin.id } });
      await logActivity(tx, { workspaceId: body.workspaceId, actorId: admin.id, entityType: "member", entityId: created.id, action: "created", summary: `Added ${created.name} as ${body.workspaceRole}` });
    }
    return created;
  });
  return NextResponse.json(
    { id: user.id, email: user.email, name: user.name, systemRole: user.systemRole, temporaryPassword: body.password ? undefined : password },
    { status: 201 }
  );
});

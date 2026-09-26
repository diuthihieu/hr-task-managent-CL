import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, route, readJson, badRequest, notFound } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { generateTemporaryPassword, hashPassword } from "@/lib/passwords";
import { nameSchema } from "@/lib/validation";

const patchSchema = z.object({
  name: nameSchema.optional(),
  systemRole: z.enum(["ADMIN", "MEMBER"]).optional(),
  isActive: z.boolean().optional(),
  resetPassword: z.literal(true).optional(),
});

async function assertNotLastAdmin(userId: string) {
  const otherAdmins = await prisma.user.count({ where: { systemRole: "ADMIN", isActive: true, deletedAt: null, id: { not: userId } } });
  if (otherAdmins === 0) throw badRequest("At least one active admin must remain");
}

export const PATCH = route<{ userId: string }>(async (req, { params }) => {
  const admin = await requireAdmin();
  const { userId } = await params;
  const body = patchSchema.parse(await readJson(req));
  const target = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
  if (!target) throw notFound("User");

  const demoting = body.systemRole === "MEMBER" && target.systemRole === "ADMIN";
  const deactivating = body.isActive === false && target.isActive;
  if ((demoting || deactivating) && target.systemRole === "ADMIN") await assertNotLastAdmin(userId);

  const temporaryPassword = body.resetPassword ? generateTemporaryPassword() : undefined;
  const passwordHash = temporaryPassword ? await hashPassword(temporaryPassword) : undefined;

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        name: body.name,
        systemRole: body.systemRole,
        isActive: body.isActive,
        ...(passwordHash ? { passwordHash, mustChangePassword: true } : {}),
        updatedById: admin.id,
      },
    });
    const log = (action: Parameters<typeof logActivity>[1]["action"], summary: string) =>
      logActivity(tx, { workspaceId: null, actorId: admin.id, entityType: "user", entityId: userId, action, summary });
    if (body.name && body.name !== target.name) await log("updated", `Renamed ${target.name} to ${body.name}`);
    if (body.systemRole && body.systemRole !== target.systemRole) await log("role_changed", `${target.email}: ${target.systemRole} → ${body.systemRole}`);
    if (body.isActive !== undefined && body.isActive !== target.isActive) await log(body.isActive ? "activated" : "deactivated", `${body.isActive ? "Reactivated" : "Deactivated"} ${target.email}`);
    if (temporaryPassword) await log("password_reset", `Reset password for ${target.email}`);
  });
  return NextResponse.json({ ok: true, temporaryPassword });
});

/** Soft delete: the row stays for audit/history, the email is released for reuse. */
export const DELETE = route<{ userId: string }>(async (_req, { params }) => {
  const admin = await requireAdmin();
  const { userId } = await params;
  if (userId === admin.id) throw badRequest("You cannot delete your own account");
  const target = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
  if (!target) throw notFound("User");
  if (target.systemRole === "ADMIN") await assertNotLastAdmin(userId);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { deletedAt: new Date(), isActive: false, email: `deleted-${userId}@users.invalid`, updatedById: admin.id },
    });
    await tx.workspaceMember.deleteMany({ where: { userId } });
    await logActivity(tx, { workspaceId: null, actorId: admin.id, entityType: "user", entityId: userId, action: "deleted", summary: `Deleted account ${target.email}`, changes: { email: { from: target.email, to: null } } });
  });
  return new NextResponse(null, { status: 204 });
});

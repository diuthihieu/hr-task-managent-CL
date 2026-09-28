import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, route, readJson, badRequest } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { assertPasswordPolicy, hashPassword } from "@/lib/passwords";

/** currentPassword may be empty only for Google-only accounts (setting a first password). */
const schema = z.object({ currentPassword: z.string().optional().default(""), newPassword: z.string() });

export const POST = route(async (req) => {
  const user = await requireUser();
  const body = schema.parse(await readJson(req));
  const newPassword = assertPasswordPolicy(body.newPassword);
  const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
  if (row.passwordHash !== null && !(await bcrypt.compare(body.currentPassword, row.passwordHash))) throw badRequest("Current password is incorrect");
  if (body.currentPassword === newPassword) throw badRequest("New password must be different");
  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false, updatedById: user.id } });
    await logActivity(tx, { workspaceId: null, actorId: user.id, entityType: "user", entityId: user.id, action: "updated", summary: "Changed own password" });
  });
  return NextResponse.json({ ok: true });
});

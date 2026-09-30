import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, route, readJson, badRequest, HttpError } from "@/lib/authz";
import { rateLimit } from "@/lib/rate-limit";
import { unstable_update } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { assertPasswordPolicy, hashPassword } from "@/lib/passwords";

/** currentPassword may be empty only for Google-only accounts (setting a first password). */
const schema = z.object({ currentPassword: z.string().optional().default(""), newPassword: z.string() });

export const POST = route(async (req) => {
  const user = await requireUser({ allowPasswordChange: true });
  if (!(await rateLimit(`pw-change:${user.id}`, 10, 15 * 60_000))) throw new HttpError(429, "Too many attempts - try again in a few minutes");
  const body = schema.parse(await readJson(req));
  const newPassword = assertPasswordPolicy(body.newPassword);
  const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
  if (row.passwordHash !== null && !(await bcrypt.compare(body.currentPassword, row.passwordHash))) throw badRequest("Current password is incorrect");
  if (body.currentPassword === newPassword) throw badRequest("New password must be different");
  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction(async (tx) => {
    // New session version: every other device is signed out; this one gets a fresh cookie below.
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false, sessionVersion: { increment: 1 }, updatedById: user.id } });
    await logActivity(tx, { workspaceId: null, actorId: user.id, entityType: "user", entityId: user.id, action: "password_changed", summary: "Changed own password" });
  });
  await unstable_update({});
  return NextResponse.json({ ok: true });
});

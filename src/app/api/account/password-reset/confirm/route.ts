import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { route, readJson, HttpError } from "@/lib/authz";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { assertPasswordPolicy, hashPassword } from "@/lib/passwords";
import { userForResetToken } from "@/lib/password-reset";
import { logSecurityEvent } from "@/lib/auth";
import { logActivity } from "@/lib/activity";

const schema = z.object({ token: z.string().max(2000), password: z.string() });

/** Sets the new password from a valid link; every signed-in device is signed out. */
export const POST = route(async (req) => {
  if (!(await rateLimit(`pw-reset-confirm:${clientIp(req)}`, 20, 3600_000))) throw new HttpError(429, "Too many attempts - try again later");
  const body = schema.parse(await readJson(req));
  const password = assertPasswordPolicy(body.password);
  const user = await userForResetToken(body.token);
  if (!user) throw new HttpError(400, "This reset link is invalid, already used or expired - ask for a new one", "invalid_token");
  const passwordHash = await hashPassword(password);
  await prisma.$transaction(async (tx) => {
    // Opening the emailed link proves the address, so it also counts as verification.
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false, sessionVersion: { increment: 1 }, ...(user.emailVerifiedAt ? {} : { emailVerifiedAt: new Date() }) } });
    await logActivity(tx, { workspaceId: null, actorId: user.id, entityType: "user", entityId: user.id, action: "password_reset", summary: "Reset password from emailed link" });
  });
  await logSecurityEvent(user.id, "password_reset", "Password reset from emailed link", req);
  return NextResponse.json({ ok: true });
});

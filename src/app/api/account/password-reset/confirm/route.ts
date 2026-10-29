import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { route, readJson, HttpError } from "@/lib/authz";
import { rateLimitByIp } from "@/lib/rate-limit";
import { assertPasswordPolicy, hashPassword } from "@/lib/passwords";
import { userForResetToken } from "@/lib/password-reset";
import { logSecurityEvent } from "@/lib/auth";
import { logActivity } from "@/lib/activity";

const schema = z.object({ token: z.string().max(2000), password: z.string() });

/** Sets the new password from a valid link; every signed-in device is signed out. */
export const POST = route(async (req) => {
  if (!(await rateLimitByIp(req, "pw-reset-confirm", 20, 3600_000, "skip"))) throw new HttpError(429, "Too many attempts - try again later");
  const body = schema.parse(await readJson(req));
  const password = assertPasswordPolicy(body.password);
  const user = await userForResetToken(body.token);
  if (!user) throw new HttpError(400, "This reset link is invalid, already used or expired - ask for a new one", "invalid_token");
  const passwordHash = await hashPassword(password);
  await prisma.$transaction(async (tx) => {
    // Single use even under concurrent requests: only the row still carrying the
    // password + session version the token was checked against is updated.
    // Opening the emailed link proves the address, so it also counts as verification.
    const r = await tx.user.updateMany({
      where: { id: user.id, passwordHash: user.passwordHash, sessionVersion: user.sessionVersion },
      data: { passwordHash, mustChangePassword: false, sessionVersion: { increment: 1 }, ...(user.emailVerifiedAt ? {} : { emailVerifiedAt: new Date() }) },
    });
    if (r.count !== 1) throw new HttpError(400, "This reset link is invalid, already used or expired - ask for a new one", "invalid_token");
    await logActivity(tx, { workspaceId: null, actorId: user.id, entityType: "user", entityId: user.id, action: "password_reset", summary: "Reset password from emailed link" });
  });
  await logSecurityEvent(user.id, "password_reset", "Password reset from emailed link", req);
  return NextResponse.json({ ok: true });
});

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { route, readJson, HttpError } from "@/lib/authz";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { mailConfigured } from "@/lib/mail";
import { sendResetEmail } from "@/lib/password-reset";
import { logSecurityEvent } from "@/lib/auth";
import { emailSchema } from "@/lib/validation";

const schema = z.object({ email: emailSchema });

/**
 * Sends a reset link when the address belongs to an active account. The answer
 * is the same either way, so the form can't be used to discover accounts.
 */
export const POST = route(async (req) => {
  if (!mailConfigured()) throw new HttpError(503, "Email isn't set up on this server - ask an administrator to reset your password", "mail_unavailable");
  if (!(await rateLimit(`pw-reset-ip:${clientIp(req)}`, 10, 3600_000))) throw new HttpError(429, "Too many requests - try again later");
  const { email } = schema.parse(await readJson(req));
  if (!(await rateLimit(`pw-reset-email:${email}`, 3, 3600_000))) return NextResponse.json({ sent: true });
  const user = await prisma.user.findFirst({ where: { email, isActive: true, deletedAt: null }, select: { id: true, email: true, name: true, locale: true, passwordHash: true, sessionVersion: true } });
  if (user) {
    const r = await sendResetEmail(user, new URL(req.url).origin);
    await logSecurityEvent(user.id, r.ok ? "password_reset_requested" : "password_reset_mail_failed", r.ok ? "Password reset link sent" : `Password reset email failed: ${r.error ?? "unknown"}`, req);
  }
  return NextResponse.json({ sent: true });
});

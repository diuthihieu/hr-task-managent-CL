import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, route, HttpError } from "@/lib/authz";
import { rateLimit } from "@/lib/rate-limit";
import { confirmEmail, sendVerificationEmail } from "@/lib/email-verification";
import { mailConfigured } from "@/lib/mail";
import { logSecurityEvent } from "@/lib/auth";

/** Opened from the email: confirms the address, then back to the app. */
export const GET = route(async (req) => {
  const url = new URL(req.url);
  const ok = await confirmEmail(url.searchParams.get("token") ?? "");
  return NextResponse.redirect(new URL(ok ? "/workspaces?verified=1" : "/workspaces?verified=0", url.origin));
});

/** (Re)send the verification link to the signed-in user. */
export const POST = route(async (req) => {
  const user = await requireUser();
  if (user.emailVerifiedAt) return NextResponse.json({ verified: true });
  if (!mailConfigured()) throw new HttpError(503, "Email isn't set up on this server - ask an administrator to verify your address", "mail_unavailable");
  if (!(await rateLimit(`verify-mail:${user.id}`, 5, 3600_000))) throw new HttpError(429, "Too many emails - try again in an hour");
  const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { id: true, email: true, name: true, locale: true } });
  const sent = await sendVerificationEmail(u, new URL(req.url).origin);
  if (!sent.ok) throw new HttpError(502, `The email provider refused to send the message (${sent.error}). Ask an administrator to check the email settings, or to verify your address.`, "mail_failed");
  await logSecurityEvent(user.id, "verification_sent", "Verification email sent", req);
  return NextResponse.json({ sent: true });
});

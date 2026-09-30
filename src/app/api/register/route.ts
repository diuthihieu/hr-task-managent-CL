import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { route, readJson, HttpError } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { assertPasswordPolicy, hashPassword, randomAvatarColor } from "@/lib/passwords";
import { emailSchema, nameSchema } from "@/lib/validation";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { sendVerificationEmail } from "@/lib/email-verification";

const schema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: z.string(),
  locale: z.enum(["vi", "en"]).optional(),
  /** Honeypot: real users never fill this hidden field. */
  website: z.string().max(0).optional(),
});

/** Open self-service sign-up. The new account can then create its own workspaces or be added to others. */
export const POST = route(async (req) => {
  if (!(await rateLimit(`register:${clientIp(req)}`, 10, 60 * 60 * 1000))) throw new HttpError(429, "Too many sign-up attempts. Try again later.");
  const body = schema.parse(await readJson(req));
  const password = assertPasswordPolicy(body.password);
  if (!(await rateLimit(`register-email:${body.email}`, 5, 24 * 3600_000))) throw new HttpError(429, "Too many sign-up attempts. Try again later.");
  if (await prisma.user.findUnique({ where: { email: body.email }, select: { id: true } })) {
    throw new HttpError(409, "An account with this email already exists. Sign in instead.");
  }
  const passwordHash = await hashPassword(password);
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        email: body.email,
        name: body.name,
        passwordHash,
        systemRole: "MEMBER",
        mustChangePassword: false,
        avatarColor: randomAvatarColor(),
        locale: body.locale ?? "vi",
      },
      select: { id: true, email: true, name: true },
    });
    await logActivity(tx, { workspaceId: null, actorId: u.id, entityType: "user", entityId: u.id, action: "created", summary: "Signed up" });
    return u;
  });
  // Email invitations are only accepted from verified addresses (someone could sign up with a colleague's email).
  const verification = (await sendVerificationEmail({ ...user, locale: body.locale ?? "vi" }, new URL(req.url).origin)) ? "sent" : "unavailable";
  return NextResponse.json({ ...user, verification }, { status: 201 });
});

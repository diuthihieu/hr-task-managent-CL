import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { randomAvatarColor } from "./passwords";
import { clientIp, rateLimit, resetRateLimit } from "./rate-limit";

/** Too many attempts: the sign-in form shows "try again later" instead of "wrong password". */
class RateLimited extends CredentialsSignin {
  code = "rate_limited";
}
const WINDOW = 15 * 60_000;

// Email + password, plus "Sign in with Google" when AUTH_GOOGLE_ID and
// AUTH_GOOGLE_SECRET are set. The JWT only carries our user id; role, active
// flag and "must change password" are re-read from the database on every
// request (src/lib/authz.ts), so revoking access is immediate.
// Compared against when the email is unknown so response time doesn't reveal which accounts exist.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12);

export const googleEnabled = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

/**
 * Finds or creates the account for a verified Google identity. An existing
 * account with the same email is linked; because sign-up by password does not
 * verify email ownership, linking drops that password (Google just proved who
 * owns the address) - the owner can set a new one from their profile.
 */
async function upsertGoogleUser(p: { sub: string; email: string; name: string }) {
  const bySub = await prisma.user.findUnique({ where: { googleSub: p.sub } });
  if (bySub) return bySub;
  const byEmail = await prisma.user.findUnique({ where: { email: p.email } });
  if (byEmail && (!byEmail.isActive || byEmail.deletedAt)) return byEmail;
  // Google proved who owns the address: drop the (possibly squatted) password and end its sessions.
  if (byEmail) return prisma.user.update({ where: { id: byEmail.id }, data: { googleSub: p.sub, passwordHash: null, mustChangePassword: false, emailVerifiedAt: new Date(), sessionVersion: { increment: 1 } } });
  return prisma.user.create({ data: { email: p.email, name: p.name.slice(0, 120) || p.email.split("@")[0], googleSub: p.sub, passwordHash: null, mustChangePassword: false, emailVerifiedAt: new Date(), avatarColor: randomAvatarColor() } });
}

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 },
  pages: { signIn: "/login" },
  trustHost: true,
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        const email = typeof credentials?.email === "string" ? credentials.email.trim().toLowerCase() : "";
        const password = typeof credentials?.password === "string" ? credentials.password : "";
        if (!email || !password) return null;
        // Shared (all instances) limits: per account against password guessing, per IP against spraying.
        const ip = request ? clientIp(request) : "unknown";
        const [okAccount, okIp] = await Promise.all([rateLimit(`login-email:${email}`, 10, WINDOW), rateLimit(`login-ip:${ip}`, 60, WINDOW)]);
        if (!okAccount || !okIp) {
          await logSecurityEvent(null, "sign_in_throttled", `Sign-in throttled for ${email}`, request);
          throw new RateLimited();
        }
        const user = await prisma.user.findUnique({ where: { email } });
        const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
        if (!user || !user.passwordHash || !valid || !user.isActive || user.deletedAt) {
          if (user) await logSecurityEvent(user.id, "sign_in_failed", "Failed sign-in (wrong password or disabled account)", request);
          return null;
        }
        await resetRateLimit(`login-email:${email}`);
        await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
        await logSecurityEvent(user.id, "sign_in", "Signed in with password", request);
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
    ...(googleEnabled ? [Google({ clientId: process.env.AUTH_GOOGLE_ID, clientSecret: process.env.AUTH_GOOGLE_SECRET })] : []),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== "google") return true;
      const email = typeof profile?.email === "string" ? profile.email.trim().toLowerCase() : "";
      if (!email || profile?.email_verified !== true || !account.providerAccountId) return "/?auth=login&error=google_unverified";
      const user = await upsertGoogleUser({ sub: account.providerAccountId, email, name: typeof profile.name === "string" ? profile.name : "" });
      if (!user.isActive || user.deletedAt) return "/?auth=login&error=account_disabled";
      await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), emailVerifiedAt: user.emailVerifiedAt ?? new Date() } });
      await logSecurityEvent(user.id, "sign_in", "Signed in with Google");
      return true;
    },
    async jwt({ token, user, account, trigger }) {
      // The session version is copied into the cookie at sign-in; bumping it in the
      // database (password change / reset, deactivation) invalidates older cookies.
      if (account?.provider === "google") {
        const u = await prisma.user.findUnique({ where: { googleSub: account.providerAccountId }, select: { id: true, sessionVersion: true } });
        if (u) {
          token.id = u.id;
          token.sv = u.sessionVersion;
        }
      } else if (user) {
        token.id = user.id;
        token.sv = (await prisma.user.findUnique({ where: { id: user.id! }, select: { sessionVersion: true } }))?.sessionVersion ?? 0;
      } else if (trigger === "update" && token.id) {
        // Re-issued for the current device right after its own password change.
        token.sv = (await prisma.user.findUnique({ where: { id: token.id as string }, select: { sessionVersion: true } }))?.sessionVersion ?? 0;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string; sv?: number }).id = token.id as string;
        (session.user as { id?: string; sv?: number }).sv = typeof token.sv === "number" ? token.sv : 0;
      }
      return session;
    },
  },
});

/** Security events (sign-in, throttling, credential changes) go to the append-only activity log. */
export async function logSecurityEvent(userId: string | null, action: string, summary: string, req?: Request | { headers: Headers } | null) {
  try {
    await prisma.activityLog.create({
      data: {
        workspaceId: null,
        actorId: userId,
        entityType: "user",
        entityId: userId ?? "00000000-0000-0000-0000-000000000000",
        action: action.slice(0, 40),
        summary: summary.slice(0, 300),
        ip: req ? clientIp(req) : null,
        userAgent: req?.headers.get("user-agent")?.slice(0, 300) ?? null,
      },
    });
  } catch (e) {
    console.error("[auth] could not log security event", e);
  }
}

import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { randomAvatarColor } from "./passwords";
import { clientIp, rateLimit, resetRateLimit } from "./rate-limit";
import { readMicrosoftIdentity, singleTenantIssuer, type MicrosoftClaims } from "./microsoft-identity";
import { verifySessionRefresh } from "./session-refresh";
import { signupDomainAllowed } from "./signup-policy";
import { hasLiveInvitation } from "./invitations";

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

// "Sign in with Microsoft" when AUTH_MICROSOFT_ENTRA_ID_ID / _SECRET are set.
// AUTH_MICROSOFT_ENTRA_ID_ISSUER picks who may sign in: a tenant id
// (https://login.microsoftonline.com/<tenant id>/v2.0) for one organization,
// or the default .../common/v2.0 for any Microsoft account.
export const microsoftEnabled = Boolean(process.env.AUTH_MICROSOFT_ENTRA_ID_ID && process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET);
const MICROSOFT_ISSUER = process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER || "https://login.microsoftonline.com/common/v2.0";
const microsoftSingleTenant = singleTenantIssuer(MICROSOFT_ISSUER);

/**
 * Finds or creates the account for a verified Google identity. An existing
 * account with the same email is linked; because sign-up by password does not
 * verify email ownership, linking drops that password (Google just proved who
 * owns the address) - the owner can set a new one from their profile.
 */
async function upsertGoogleUser(p: { sub: string; email: string; name: string }): Promise<{ user?: Awaited<ReturnType<typeof prisma.user.findUnique>>; error?: string }> {
  const bySub = await prisma.user.findUnique({ where: { googleSub: p.sub } });
  if (bySub) return { user: bySub };
  const byEmail = await prisma.user.findUnique({ where: { email: p.email } });
  if (byEmail && (!byEmail.isActive || byEmail.deletedAt)) return { user: byEmail };
  // Google proved who owns the address: drop the (possibly squatted) password and end its sessions.
  if (byEmail) return { user: await prisma.user.update({ where: { id: byEmail.id }, data: { googleSub: p.sub, passwordHash: null, mustChangePassword: false, emailVerifiedAt: new Date(), sessionVersion: { increment: 1 } } }) };
  if (!(await mayCreateAccount(p.email))) return { error: "domain_not_allowed" };
  return { user: await prisma.user.create({ data: { email: p.email, name: p.name.slice(0, 120) || p.email.split("@")[0], googleSub: p.sub, passwordHash: null, mustChangePassword: false, emailVerifiedAt: new Date(), avatarColor: randomAvatarColor() } }) };
}

/** New accounts follow the same rule as /api/register: SIGNUP_ALLOWED_DOMAINS (empty = open) or a live invitation. */
async function mayCreateAccount(email: string) {
  return signupDomainAllowed(email) || hasLiveInvitation(email);
}

/**
 * Finds or creates the account for a Microsoft identity. The email must be
 * trusted (see microsoft-identity.ts) to create or link an account; otherwise
 * the sign-in is refused rather than letting an unverified address claim one.
 */
async function upsertMicrosoftUser(id: { key: string; email: string; name: string; emailTrusted: boolean }): Promise<{ user?: Awaited<ReturnType<typeof prisma.user.findUnique>>; error?: string }> {
  const byKey = await prisma.user.findUnique({ where: { microsoftSub: id.key } });
  if (byKey) return { user: byKey };
  if (!id.email) return { error: "microsoft_no_email" };
  // An unverified email is never bound to a local account, new or existing:
  // otherwise any tenant admin could pre-register someone else's address.
  if (!id.emailTrusted) return { error: "microsoft_unverified" };
  const byEmail = await prisma.user.findUnique({ where: { email: id.email } });
  if (byEmail) {
    if (!byEmail.isActive || byEmail.deletedAt) return { user: byEmail };
    return { user: await prisma.user.update({ where: { id: byEmail.id }, data: { microsoftSub: id.key, passwordHash: null, mustChangePassword: false, emailVerifiedAt: byEmail.emailVerifiedAt ?? new Date(), sessionVersion: { increment: 1 } } }) };
  }
  if (!(await mayCreateAccount(id.email))) return { error: "domain_not_allowed" };
  return {
    user: await prisma.user.create({
      data: { email: id.email, name: id.name || id.email.split("@")[0], microsoftSub: id.key, passwordHash: null, mustChangePassword: false, emailVerifiedAt: new Date(), avatarColor: randomAvatarColor() },
    }),
  };
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
    ...(microsoftEnabled
      ? [
          MicrosoftEntraID({
            clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
            clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
            issuer: MICROSOFT_ISSUER,
            // No profile photo download (an extra Graph call we don't use).
            profilePhotoSize: 48,
            profile: (p) => ({ id: p.sub, name: p.name, email: p.email ?? null, image: null }),
          }),
        ]
      : []),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider === "microsoft-entra-id") {
        const id = readMicrosoftIdentity(profile as MicrosoftClaims, microsoftSingleTenant);
        if (!id) return "/?auth=login&error=microsoft_no_email";
        const r = await upsertMicrosoftUser(id);
        if (r.error || !r.user) return `/?auth=login&error=${r.error ?? "microsoft_no_email"}`;
        if (!r.user.isActive || r.user.deletedAt) return "/?auth=login&error=account_disabled";
        await prisma.user.update({ where: { id: r.user.id }, data: { lastLoginAt: new Date() } });
        await logSecurityEvent(r.user.id, "sign_in", "Signed in with Microsoft");
        return true;
      }
      if (account?.provider !== "google") return true;
      const email = typeof profile?.email === "string" ? profile.email.trim().toLowerCase() : "";
      if (!email || profile?.email_verified !== true || !account.providerAccountId) return "/?auth=login&error=google_unverified";
      const r = await upsertGoogleUser({ sub: account.providerAccountId, email, name: typeof profile.name === "string" ? profile.name : "" });
      if (r.error || !r.user) return `/?auth=login&error=${r.error ?? "google_unverified"}`;
      const user = r.user;
      if (!user.isActive || user.deletedAt) return "/?auth=login&error=account_disabled";
      await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), emailVerifiedAt: user.emailVerifiedAt ?? new Date() } });
      await logSecurityEvent(user.id, "sign_in", "Signed in with Google");
      return true;
    },
    async jwt({ token, user, account, trigger, profile, session }) {
      // The session version is copied into the cookie at sign-in; bumping it in the
      // database (password change / reset, deactivation) invalidates older cookies.
      if (account?.provider === "microsoft-entra-id") {
        const id = readMicrosoftIdentity(profile as MicrosoftClaims, microsoftSingleTenant);
        const u = id ? await prisma.user.findUnique({ where: { microsoftSub: id.key }, select: { id: true, sessionVersion: true } }) : null;
        if (u) {
          token.id = u.id;
          token.sv = u.sessionVersion;
        }
      } else if (account?.provider === "google") {
        const u = await prisma.user.findUnique({ where: { googleSub: account.providerAccountId }, select: { id: true, sessionVersion: true } });
        if (u) {
          token.id = u.id;
          token.sv = u.sessionVersion;
        }
      } else if (user) {
        token.id = user.id;
        token.sv = (await prisma.user.findUnique({ where: { id: user.id! }, select: { sessionVersion: true } }))?.sessionVersion ?? 0;
      } else if (token.id) {
        // Every later read (GET /api/auth/session re-signs the cookie; POST is the
        // browser's update()) checks the version again, so a revoked cookie is
        // dropped instead of being extended or revived.
        let current: number | undefined;
        try {
          current = (await prisma.user.findUnique({ where: { id: token.id as string }, select: { sessionVersion: true } }))?.sessionVersion ?? -1;
        } catch (e) {
          // Database unreachable: keep the cookie as it is (authz refuses it anyway without the database).
          console.error("[auth] could not check the session version", e);
          return token;
        }
        if (current !== token.sv) {
          // Only the device that just changed its own password gets the new version, via a server-minted proof.
          const proof = (session as { svProof?: unknown } | undefined)?.svProof;
          if (trigger !== "update" || !verifySessionRefresh(proof, token.id as string, current)) return null;
          token.sv = current;
        }
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

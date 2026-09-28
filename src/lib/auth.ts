import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { randomAvatarColor } from "./passwords";

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
  if (byEmail) return prisma.user.update({ where: { id: byEmail.id }, data: { googleSub: p.sub, passwordHash: null, mustChangePassword: false } });
  return prisma.user.create({ data: { email: p.email, name: p.name.slice(0, 120) || p.email.split("@")[0], googleSub: p.sub, passwordHash: null, mustChangePassword: false, avatarColor: randomAvatarColor() } });
}

export const { handlers, auth, signIn, signOut } = NextAuth({
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
      async authorize(credentials) {
        const email = typeof credentials?.email === "string" ? credentials.email.trim().toLowerCase() : "";
        const password = typeof credentials?.password === "string" ? credentials.password : "";
        if (!email || !password) return null;
        const user = await prisma.user.findUnique({ where: { email } });
        const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
        if (!user || !user.passwordHash || !valid || !user.isActive || user.deletedAt) return null;
        await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
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
      await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      return true;
    },
    async jwt({ token, user, account }) {
      if (account?.provider === "google") {
        const u = await prisma.user.findUnique({ where: { googleSub: account.providerAccountId }, select: { id: true } });
        if (u) token.id = u.id;
      } else if (user) token.id = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user) (session.user as { id?: string }).id = token.id as string;
      return session;
    },
  },
});

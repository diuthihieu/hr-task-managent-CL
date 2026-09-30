import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "./prisma";
import { mailConfigured, sendMail } from "./mail";

// Email ownership. Google sign-in, an admin-created account or an admin's
// confirmation count as proof; password sign-ups prove it by opening a signed,
// expiring link that is bound to both the account and the exact address.

const TTL_MS = 48 * 3600_000;
const key = () => {
  const s = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return createHmac("sha256", s).update("email-verification-v1").digest();
};
const b64 = (b: Buffer) => b.toString("base64url");

export function verificationToken(userId: string, email: string, now = Date.now()) {
  const payload = b64(Buffer.from(JSON.stringify({ u: userId, e: email.toLowerCase(), x: now + TTL_MS })));
  return `${payload}.${b64(createHmac("sha256", key()).update(payload).digest())}`;
}

export function readVerificationToken(token: string, now = Date.now()): { userId: string; email: string } | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", key()).update(payload).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { u: string; e: string; x: number };
    if (typeof p.u !== "string" || typeof p.e !== "string" || typeof p.x !== "number" || p.x < now) return null;
    return { userId: p.u, email: p.e };
  } catch {
    return null;
  }
}

/** Marks the address verified if the token still matches the account's current email. */
export async function confirmEmail(token: string) {
  const t = readVerificationToken(token);
  if (!t) return false;
  const r = await prisma.user.updateMany({ where: { id: t.userId, email: t.email, deletedAt: null }, data: { emailVerifiedAt: new Date() } });
  return r.count === 1;
}

/** Sends the verification link; false when email isn't configured on this server. */
export async function sendVerificationEmail(user: { id: string; email: string; name: string; locale?: string | null }, origin: string) {
  if (!mailConfigured()) return false;
  const link = `${origin}/api/account/verify-email?token=${encodeURIComponent(verificationToken(user.id, user.email))}`;
  const vi = user.locale !== "en";
  return sendMail(
    user.email,
    vi ? "Xác minh email cho tài khoản woli" : "Verify your email for woli",
    vi
      ? `Chào ${user.name},\n\nBấm vào link sau để xác minh email (hết hạn sau 48 giờ):\n${link}\n\nNếu bạn không tạo tài khoản woli, hãy bỏ qua email này.`
      : `Hi ${user.name},\n\nOpen this link to verify your email (expires in 48 hours):\n${link}\n\nIf you didn't create a woli account, ignore this email.`
  );
}

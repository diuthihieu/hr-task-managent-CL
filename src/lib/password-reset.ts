import "server-only";
import { prisma } from "./prisma";
import { mailConfigured, sendMailDetailed, simpleHtmlEmail, type MailResult } from "./mail";
import { fingerprint, readResetToken, resetToken } from "./password-reset-token";

// "Forgot password": a signed link that expires after an hour and works once.
// It is bound to the account and to a fingerprint of its current password and
// session version, so setting a new password (or any other password change)
// invalidates every link sent before. Nothing is stored server-side.

/** The active account a token still belongs to (expired, used or tampered tokens give null). */
export async function userForResetToken(token: string, now = Date.now()) {
  const t = readResetToken(token, now);
  if (!t) return null;
  const u = await prisma.user.findFirst({ where: { id: t.userId, isActive: true, deletedAt: null }, select: { id: true, email: true, passwordHash: true, sessionVersion: true, emailVerifiedAt: true } });
  if (!u || fingerprint(u) !== t.fp) return null;
  return u;
}

export async function sendResetEmail(user: { id: string; email: string; name: string; locale: string | null; passwordHash: string | null; sessionVersion: number }, origin: string): Promise<MailResult> {
  if (!mailConfigured()) return { ok: false, error: "Email isn't configured" };
  const link = `${origin}/reset-password?token=${encodeURIComponent(resetToken(user))}`;
  const vi = user.locale !== "en";
  return sendMailDetailed(
    user.email,
    vi ? "Đặt lại mật khẩu woli" : "Reset your woli password",
    vi
      ? `Chào ${user.name},\n\nBấm vào link sau để đặt mật khẩu mới (hết hạn sau 1 giờ, chỉ dùng một lần):\n${link}\n\nNếu bạn không yêu cầu, hãy bỏ qua email này - mật khẩu hiện tại vẫn giữ nguyên.`
      : `Hi ${user.name},\n\nOpen this link to choose a new password (expires in 1 hour, works once):\n${link}\n\nIf you didn't ask for this, ignore this email - your current password stays the same.`,
    simpleHtmlEmail(
      vi
        ? { heading: `Chào ${user.name},`, intro: "Có yêu cầu đặt lại mật khẩu cho tài khoản woli của bạn. Bấm nút bên dưới để đặt mật khẩu mới. Link hết hạn sau 1 giờ và chỉ dùng được một lần.", button: "Đặt mật khẩu mới", link, footer: "Nếu bạn không yêu cầu, hãy bỏ qua email này - mật khẩu hiện tại vẫn giữ nguyên. Nếu nút không hoạt động, mở link sau:" }
        : { heading: `Hi ${user.name},`, intro: "Someone asked to reset the password of your woli account. Press the button below to choose a new one. The link expires in 1 hour and works once.", button: "Choose a new password", link, footer: "If you didn't ask for this, ignore this email - your current password stays the same. If the button doesn't work, open this link:" }
    )
  );
}

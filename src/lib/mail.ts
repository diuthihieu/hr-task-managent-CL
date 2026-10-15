import "server-only";

import nodemailer, { type Transporter } from "nodemailer";

// Transactional email, through either provider:
// - SMTP (e.g. a Gmail account with an app password) when SMTP_HOST,
//   SMTP_USER, SMTP_PASS and MAIL_FROM are set - no domain or DNS needed;
// - otherwise Resend's HTTP API when RESEND_API_KEY and MAIL_FROM are set.
// Without either nothing is sent and callers fall back (an admin verifies the
// address / resets the password). Secrets never reach the browser.

const smtpConfigured = () => Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const resendConfigured = () => Boolean(process.env.RESEND_API_KEY);

export function mailConfigured() {
  return Boolean(process.env.MAIL_FROM && (smtpConfigured() || resendConfigured()));
}

/** What an admin needs to fix email, without revealing any secret. */
export function mailStatus() {
  const from = process.env.MAIL_FROM ?? "";
  const domain = from.match(/@([^>\s]+)/)?.[1]?.toLowerCase() ?? null;
  const provider: "smtp" | "resend" | null = smtpConfigured() ? "smtp" : resendConfigured() ? "resend" : null;
  const missing = [!provider && "SMTP_HOST + SMTP_USER + SMTP_PASS (or RESEND_API_KEY)", !from && "MAIL_FROM"].filter(Boolean) as string[];
  return {
    configured: mailConfigured(),
    provider,
    missing,
    from: from || null,
    // Resend's shared test sender only delivers to the Resend account owner's own address.
    testSender: provider === "resend" && domain === "resend.dev",
  };
}

export interface MailResult {
  ok: boolean;
  id?: string;
  /** Why the provider refused (e.g. wrong app password, unverified sending domain). */
  error?: string;
}

let transporter: Transporter | null = null;
function smtp(): Transporter {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT) || 465;
    // TLS from the first byte on 465 (or SMTP_SECURE=true); otherwise STARTTLS, which we require.
    const secure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465;
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure,
      requireTLS: !secure,
      auth: { user: process.env.SMTP_USER, pass: (process.env.SMTP_PASS ?? "").replace(/\s+/g, "") },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  return transporter;
}

async function sendViaSmtp(to: string, subject: string, text: string, html?: string): Promise<MailResult> {
  try {
    const info = await smtp().sendMail({ from: process.env.MAIL_FROM, to, subject, text, ...(html ? { html } : {}) });
    return { ok: true, id: info.messageId };
  } catch (e) {
    const err = e as { code?: string; responseCode?: number; message?: string };
    // e.g. 535 = wrong user / app password; EAUTH, ETIMEDOUT, ECONNECTION
    const error = `${err.responseCode ?? err.code ?? "SMTP"}: ${(err.message ?? "").slice(0, 300)}`;
    console.error("[mail] smtp send failed", error);
    return { ok: false, error };
  }
}

async function sendViaResend(to: string, subject: string, text: string, html?: string): Promise<MailResult> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, text, ...(html ? { html } : {}) }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (!res.ok) {
      const error = `${res.status}${body.name ? ` ${body.name}` : ""}: ${(body.message ?? res.statusText ?? "").slice(0, 300)}`;
      console.error("[mail] send failed", error);
      return { ok: false, error };
    }
    return { ok: true, id: body.id };
  } catch (e) {
    console.error("[mail] send failed", e);
    return { ok: false, error: (e as Error).message };
  }
}

export async function sendMailDetailed(to: string, subject: string, text: string, html?: string): Promise<MailResult> {
  if (!mailConfigured()) return { ok: false, error: `Email isn't configured (missing ${mailStatus().missing.join(", ")})` };
  return smtpConfigured() ? sendViaSmtp(to, subject, text, html) : sendViaResend(to, subject, text, html);
}

export async function sendMail(to: string, subject: string, text: string, html?: string): Promise<boolean> {
  return (await sendMailDetailed(to, subject, text, html)).ok;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A plain, client-safe HTML email with one button. */
export function simpleHtmlEmail(o: { heading: string; intro: string; button: string; link: string; footer: string }) {
  return `<!doctype html><html><body style="margin:0;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;color:#1c1917">
<div style="max-width:520px;margin:24px auto;background:#fff;border-radius:12px;padding:28px">
<div style="font-size:20px;font-weight:700;color:#ea580c;margin-bottom:16px">woli</div>
<h1 style="font-size:18px;margin:0 0 12px">${esc(o.heading)}</h1>
<p style="font-size:14px;line-height:1.6;margin:0 0 20px">${esc(o.intro)}</p>
<a href="${esc(o.link)}" style="display:inline-block;background:#ea580c;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:8px">${esc(o.button)}</a>
<p style="font-size:12px;color:#78716c;line-height:1.6;margin:20px 0 0">${esc(o.footer)}<br><span style="word-break:break-all">${esc(o.link)}</span></p>
</div></body></html>`;
}

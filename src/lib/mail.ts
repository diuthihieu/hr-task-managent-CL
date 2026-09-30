import "server-only";

// Transactional email through Resend's HTTP API when RESEND_API_KEY and
// MAIL_FROM are set. Without them nothing is sent and callers fall back
// (e.g. an admin verifies the address). The API key never reaches the browser.

export function mailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

/** What an admin needs to fix email, without revealing the key. */
export function mailStatus() {
  const from = process.env.MAIL_FROM ?? "";
  const domain = from.match(/@([^>\s]+)/)?.[1] ?? null;
  return {
    configured: mailConfigured(),
    missing: [!process.env.RESEND_API_KEY && "RESEND_API_KEY", !from && "MAIL_FROM"].filter(Boolean) as string[],
    from: from || null,
    // Resend's shared test sender only delivers to the Resend account owner's own address.
    testSender: domain === "resend.dev",
  };
}

export interface MailResult {
  ok: boolean;
  id?: string;
  /** Why the provider refused (e.g. an unverified sending domain). */
  error?: string;
}

export async function sendMailDetailed(to: string, subject: string, text: string, html?: string): Promise<MailResult> {
  if (!mailConfigured()) return { ok: false, error: `Email isn't configured (missing ${mailStatus().missing.join(", ")})` };
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

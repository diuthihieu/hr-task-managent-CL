import { NextResponse } from "next/server";
import { requireAdmin, route } from "@/lib/authz";
import { mailStatus, sendMailDetailed, simpleHtmlEmail } from "@/lib/mail";
import { rateLimit } from "@/lib/rate-limit";
import { HttpError } from "@/lib/http-errors";

/** Email setup for system admins: what is configured (never the key). */
export const GET = route(async () => {
  await requireAdmin();
  return NextResponse.json(mailStatus());
});

/** Send a test email to the admin's own address and report the provider's answer. */
export const POST = route(async (req) => {
  const admin = await requireAdmin();
  if (!(await rateLimit(`mail-test:${admin.id}`, 5, 3600_000))) throw new HttpError(429, "Too many test emails - try again later");
  const origin = new URL(req.url).origin;
  const r = await sendMailDetailed(
    admin.email,
    "woli test email",
    `This is a test email from ${origin}. If you can read it, email delivery works.`,
    simpleHtmlEmail({ heading: "Email works", intro: `This is a test email from ${origin}. Verification emails and invitations will be delivered the same way.`, button: "Open woli", link: origin, footer: "Sent from the admin console." })
  );
  return NextResponse.json({ ...mailStatus(), to: admin.email, ...r });
});

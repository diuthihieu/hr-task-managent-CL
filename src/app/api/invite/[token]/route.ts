import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, route, readJson, notFound } from "@/lib/authz";
import { resolveInviteToken, respondToInvite } from "@/lib/invitations";

type P = { token: string };

/** What the invite link points at (signed-in users only - the page asks them to sign in first). */
export const GET = route<P>(async (_req, { params }) => {
  await requireUser();
  const { token } = await params;
  const t = await resolveInviteToken(token);
  if (!t) throw notFound("Invitation");
  return NextResponse.json({ kind: t.kind, state: t.state, email: t.email, role: t.role, message: t.message, invitedBy: t.invitedBy, workspace: { name: t.workspace.name, members: t.workspace._count.members } });
});

const schema = z.object({ decision: z.enum(["accept", "decline"]) });

/** Accept (join) or decline. */
export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { token } = await params;
  const { decision } = schema.parse(await readJson(req));
  return NextResponse.json(await respondToInvite(user, token, decision));
});

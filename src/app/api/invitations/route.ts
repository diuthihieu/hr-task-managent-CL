import { NextResponse } from "next/server";
import { requireUser, route } from "@/lib/authz";
import { pendingInvitationsFor, syncInvitations } from "@/lib/invitations";

/** My open invitations to workspaces. */
export const GET = route(async () => {
  const user = await requireUser();
  await syncInvitations(user);
  return NextResponse.json(await pendingInvitationsFor(user));
});

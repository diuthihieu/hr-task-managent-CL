import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/authz";
import { resolveInviteToken } from "@/lib/invitations";
import { InviteCard } from "@/components/invitations/invite-card";

export const dynamic = "force-dynamic";

/** Landing page of an invite link: sign in (or sign up), then accept or decline. */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await getSessionUser();
  if (!user) redirect(`/?auth=register&callbackUrl=${encodeURIComponent(`/invite/${token}`)}`);
  const target = await resolveInviteToken(token);
  if (target && (await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: target.workspace.id, userId: user.id } } }))) redirect(`/w/${target.workspace.slug}`);
  return (
    <InviteCard
      token={token}
      user={{ name: user.name, email: user.email }}
      invite={
        target
          ? { kind: target.kind, state: target.state, email: target.email, role: target.role, message: target.message, invitedBy: target.invitedBy, workspaceName: target.workspace.name, members: target.workspace._count.members }
          : null
      }
    />
  );
}

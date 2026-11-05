import { prisma } from "@/lib/prisma";
import { mailConfigured } from "@/lib/mail";
import { workspaceLogoUrl } from "@/lib/workspace-logo";
import { requirePageUser } from "@/lib/page-context";
import { WorkspaceChooser, type WorkspaceCard } from "@/components/workspaces/workspace-chooser";
import { pendingInvitationsFor, syncInvitations } from "@/lib/invitations";
import { resumePath } from "@/lib/last-workspace";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** After sign-in: pick one of your workspaces (or create one). */
export default async function WorkspacesPage({ searchParams }: { searchParams: Promise<{ source?: string; resume?: string }> }) {
  const user = await requirePageUser();
  // Opening woli (installed app: ?source=app; site root / after sign-in: ?resume=1) reopens the workspace
  // last used on this device. A plain visit (switching workspace) still shows the chooser.
  const { source, resume } = await searchParams;
  if (source === "app" || resume === "1") {
    const target = await resumePath(user.id);
    if (target) redirect(target);
  }
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId: user.id, workspace: { deletedAt: null } },
    orderBy: { createdAt: "asc" },
    include: {
      workspace: {
        include: { _count: { select: { members: true, projects: { where: { deletedAt: null } } } } },
      },
    },
  });
  const cards: WorkspaceCard[] = memberships.map((m) => ({
    id: m.workspace.id,
    name: m.workspace.name,
    slug: m.workspace.slug,
    description: m.workspace.description,
    logoUrl: workspaceLogoUrl(m.workspace),
    role: m.role,
    projects: m.workspace._count.projects,
    members: m.workspace._count.members,
  }));
  await syncInvitations(user);
  const invites = await pendingInvitationsFor(user);
  return <WorkspaceChooser invites={invites} user={{ id: user.id, name: user.name, email: user.email, avatarColor: user.avatarColor, isAdmin: user.systemRole === "ADMIN", emailVerified: !!user.emailVerifiedAt, mailEnabled: mailConfigured() }} workspaces={cards} />;
}

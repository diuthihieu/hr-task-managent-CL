import { prisma } from "@/lib/prisma";
import { workspaceLogoUrl } from "@/lib/workspace-logo";
import { requirePageUser } from "@/lib/page-context";
import { WorkspaceChooser, type WorkspaceCard } from "@/components/workspaces/workspace-chooser";
import { pendingInvitationsFor, syncInvitations } from "@/lib/invitations";

export const dynamic = "force-dynamic";

/** After sign-in: pick one of your workspaces (or create one). */
export default async function WorkspacesPage() {
  const user = await requirePageUser();
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
  return <WorkspaceChooser invites={invites} user={{ id: user.id, name: user.name, email: user.email, avatarColor: user.avatarColor, isAdmin: user.systemRole === "ADMIN" }} workspaces={cards} />;
}

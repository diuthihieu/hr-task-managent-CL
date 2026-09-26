import { prisma } from "@/lib/prisma";
import { requireWorkspacePage } from "@/lib/page-context";
import { WorkspaceShell } from "@/components/layout/workspace-shell";

export default async function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { user, workspace, role } = await requireWorkspacePage(workspaceSlug);

  const workspaces =
    user.systemRole === "ADMIN"
      ? await prisma.workspace.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, slug: true } })
      : (await prisma.workspaceMember.findMany({ where: { userId: user.id, workspace: { deletedAt: null } }, include: { workspace: true }, orderBy: { createdAt: "asc" } })).map((m) => ({ id: m.workspace.id, name: m.workspace.name, slug: m.workspace.slug }));

  const projects = await prisma.project.findMany({
    where: { workspaceId: workspace.id, deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, color: true, views: { orderBy: { sortOrder: "asc" }, select: { id: true, name: true, type: true } } },
  });

  return (
    <WorkspaceShell
      workspace={{ id: workspace.id, name: workspace.name, slug: workspace.slug }}
      workspaces={workspaces}
      projects={projects}
      user={{ id: user.id, name: user.name, email: user.email, systemRole: user.systemRole, avatarColor: user.avatarColor }}
      role={role}
    >
      {children}
    </WorkspaceShell>
  );
}

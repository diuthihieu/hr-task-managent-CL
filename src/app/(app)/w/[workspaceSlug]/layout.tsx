import { visibleProjectWhere, visibleWikiWhere } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { requireWorkspacePage } from "@/lib/page-context";
import type { Metadata } from "next";
import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { workspaceLogoUrl } from "@/lib/workspace-logo";

/** Tab title + favicon follow the workspace (its logo when one is set). */
export async function generateMetadata({ params }: { params: Promise<{ workspaceSlug: string }> }): Promise<Metadata> {
  const { workspaceSlug } = await params;
  const w = await prisma.workspace.findFirst({ where: { slug: workspaceSlug, deletedAt: null }, select: { name: true, slug: true, logoUpdatedAt: true } });
  if (!w) return {};
  const logo = workspaceLogoUrl(w);
  return {
    title: { default: `${w.name} · woli`, template: `%s · ${w.name}` },
    ...(logo ? { icons: { icon: logo, apple: logo } } : {}),
  };
}

export default async function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { user, workspace, role } = await requireWorkspacePage(workspaceSlug);

  // The switcher lists the caller's own memberships (a system admin opening
  // someone else's workspace for support still sees it as the current one).
  const memberships = await prisma.workspaceMember.findMany({ where: { userId: user.id, workspace: { deletedAt: null } }, include: { workspace: true }, orderBy: { createdAt: "asc" } });
  const workspaces = memberships.map((m) => ({ id: m.workspace.id, name: m.workspace.name, slug: m.workspace.slug, logoUrl: workspaceLogoUrl(m.workspace) }));
  if (!workspaces.some((w) => w.id === workspace.id)) workspaces.unshift({ id: workspace.id, name: workspace.name, slug: workspace.slug, logoUrl: workspaceLogoUrl(workspace) });

  const projects = await prisma.project.findMany({
    where: { workspaceId: workspace.id, deletedAt: null, ...visibleProjectWhere(user) },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, color: true, views: { orderBy: { sortOrder: "asc" }, select: { id: true, name: true, type: true } } },
  });

  const me = await prisma.user.findUnique({ where: { id: user.id }, select: { avatarUpdatedAt: true } });

  const wikis = await prisma.wiki.findMany({
    where: { workspaceId: workspace.id, ...visibleWikiWhere(user, role) },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, icon: true, color: true, access: true },
  });

  return (
    <WorkspaceShell
      wikis={wikis}
      workspace={{ id: workspace.id, name: workspace.name, slug: workspace.slug, logoUrl: workspaceLogoUrl(workspace) }}
      workspaces={workspaces}
      projects={projects}
      user={{ id: user.id, name: user.name, email: user.email, systemRole: user.systemRole, avatarColor: user.avatarColor, avatarUrl: me?.avatarUpdatedAt ? `/api/users/${user.id}/avatar?v=${me.avatarUpdatedAt.getTime()}` : null }}
      role={role}
    >
      {children}
    </WorkspaceShell>
  );
}

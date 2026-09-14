import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { WorkspaceShell } from "@/components/layout/workspace-shell";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { workspaceSlug } = await params;
  const userId = (session.user as { id: string }).id;

  const workspace = await prisma.workspace.findUnique({ where: { slug: workspaceSlug } });
  if (!workspace) redirect("/");

  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId } },
  });
  if (!membership) redirect("/");

  const allMemberships = await prisma.workspaceMember.findMany({
    where: { userId },
    include: { workspace: true },
    orderBy: { createdAt: "asc" },
  });

  const bases = await prisma.base.findMany({
    where: { workspaceId: workspace.id, archived: false },
    orderBy: { order: "asc" },
    include: {
      tables: {
        where: { archived: false },
        orderBy: { order: "asc" },
        select: { id: true, name: true, icon: true, views: { orderBy: { order: "asc" }, select: { id: true, name: true, type: true } } },
      },
      dashboards: { orderBy: { createdAt: "asc" }, select: { id: true, name: true } },
    },
  });

  return (
    <WorkspaceShell
      workspace={{ id: workspace.id, name: workspace.name, slug: workspace.slug }}
      workspaces={allMemberships.map((m) => ({ id: m.workspace.id, name: m.workspace.name, slug: m.workspace.slug }))}
      bases={bases}
      user={{ id: userId, name: session.user.name || session.user.email || "User", email: session.user.email || "" }}
    >
      {children}
    </WorkspaceShell>
  );
}

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SettingsWorkspace } from "@/components/settings/settings-workspace";

export default async function SettingsPage({
  params,
}: {
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

  return <SettingsWorkspace workspaceId={workspace.id} workspaceSlug={workspaceSlug} currentUserId={userId} currentUserRole={membership.role} />;
}

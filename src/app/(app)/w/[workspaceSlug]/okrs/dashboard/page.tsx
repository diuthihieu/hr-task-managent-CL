import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { OkrDashboard } from "@/components/okr/okr-dashboard";

export default async function OkrDashboardPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { workspaceSlug } = await params;
  const workspace = await prisma.workspace.findUnique({ where: { slug: workspaceSlug } });
  if (!workspace) redirect("/");

  return <OkrDashboard workspaceId={workspace.id} workspaceSlug={workspaceSlug} />;
}

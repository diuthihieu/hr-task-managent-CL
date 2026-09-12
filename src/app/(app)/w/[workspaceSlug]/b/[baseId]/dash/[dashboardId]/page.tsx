import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { DashboardWorkspace } from "@/components/dashboard/dashboard-workspace";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; baseId: string; dashboardId: string }>;
}) {
  const { workspaceSlug, baseId, dashboardId } = await params;
  const dashboard = await prisma.dashboard.findUnique({
    where: { id: dashboardId },
    include: { base: { select: { name: true, workspace: { select: { name: true } } } } },
  });
  if (!dashboard) redirect(`/w/${workspaceSlug}/b/${baseId}`);

  return (
    <DashboardWorkspace
      dashboardId={dashboardId}
      baseId={baseId}
      workspaceSlug={workspaceSlug}
      breadcrumb={{ workspace: dashboard.base.workspace.name, base: dashboard.base.name, dashboard: dashboard.name }}
    />
  );
}

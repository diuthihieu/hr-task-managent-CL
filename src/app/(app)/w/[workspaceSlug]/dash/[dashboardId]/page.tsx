import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireWorkspacePage } from "@/lib/page-context";
import { DashboardWorkspace } from "@/components/dashboard/dashboard-workspace";

export default async function DashboardPage({ params }: { params: Promise<{ workspaceSlug: string; dashboardId: string }> }) {
  const { workspaceSlug, dashboardId } = await params;
  const { workspace, role } = await requireWorkspacePage(workspaceSlug);
  const dashboard = await prisma.dashboard.findFirst({ where: { id: dashboardId, workspaceId: workspace.id }, select: { name: true } });
  if (!dashboard) redirect(`/w/${workspaceSlug}/dashboards`);
  return <DashboardWorkspace dashboardId={dashboardId} workspaceId={workspace.id} workspaceSlug={workspaceSlug} canEdit={["owner", "admin", "editor"].includes(role)} breadcrumb={{ workspace: workspace.name, dashboard: dashboard.name }} />;
}

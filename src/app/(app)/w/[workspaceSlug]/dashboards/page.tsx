import { requireWorkspacePage } from "@/lib/page-context";
import { DashboardsIndex } from "@/components/dashboard/dashboards-index";

export default async function DashboardsIndexPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace, role } = await requireWorkspacePage(workspaceSlug);
  return <DashboardsIndex workspaceId={workspace.id} workspaceSlug={workspaceSlug} canEdit={["owner", "admin", "editor"].includes(role)} />;
}

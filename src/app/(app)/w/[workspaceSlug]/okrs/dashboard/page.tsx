import { requireWorkspacePage } from "@/lib/page-context";
import { OkrDashboard } from "@/components/okr/okr-dashboard";

export default async function OkrDashboardPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireWorkspacePage(workspaceSlug);

  return <OkrDashboard workspaceId={workspace.id} workspaceSlug={workspaceSlug} />;
}

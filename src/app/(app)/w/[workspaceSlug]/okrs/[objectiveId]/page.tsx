import { requireWorkspacePage } from "@/lib/page-context";
import { ObjectiveDetail } from "@/components/okr/objective-detail";

export default async function ObjectiveDetailPage({ params }: { params: Promise<{ workspaceSlug: string; objectiveId: string }> }) {
  const { workspaceSlug, objectiveId } = await params;
  const { workspace } = await requireWorkspacePage(workspaceSlug);

  return <ObjectiveDetail objectiveId={objectiveId} workspaceId={workspace.id} workspaceSlug={workspaceSlug} />;
}

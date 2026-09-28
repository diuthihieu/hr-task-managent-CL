import { requireWorkspacePage } from "@/lib/page-context";
import { ObjectiveDetail } from "@/components/okr/objective-detail";

export default async function ObjectiveDetailPage({ params, searchParams }: { params: Promise<{ workspaceSlug: string; objectiveId: string }>; searchParams: Promise<{ mine?: string }> }) {
  const { workspaceSlug, objectiveId } = await params;
  const { mine } = await searchParams;
  const { workspace } = await requireWorkspacePage(workspaceSlug);

  return <ObjectiveDetail mine={mine === "1"} objectiveId={objectiveId} workspaceId={workspace.id} workspaceSlug={workspaceSlug} />;
}

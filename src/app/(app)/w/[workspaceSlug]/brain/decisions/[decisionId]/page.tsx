import { requireWorkspacePage } from "@/lib/page-context";
import { DecisionDetail } from "@/components/brain/decision-detail";

export const metadata = { title: "Decision" };

export default async function DecisionPage({ params }: { params: Promise<{ workspaceSlug: string; decisionId: string }> }) {
  const { workspaceSlug, decisionId } = await params;
  const { workspace } = await requireWorkspacePage(workspaceSlug);
  return <DecisionDetail workspaceId={workspace.id} workspaceSlug={workspaceSlug} decisionId={decisionId} />;
}

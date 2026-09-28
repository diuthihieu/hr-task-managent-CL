import { requireWorkspacePage } from "@/lib/page-context";
import { workspaceLogoUrl } from "@/lib/workspace-logo";
import { AiAssistant } from "@/components/ai/ai-assistant";

export const metadata = { title: "AI Assistant" };

export default async function AiPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { user, workspace } = await requireWorkspacePage(workspaceSlug);
  return <AiAssistant workspaceId={workspace.id} workspaceName={workspace.name} logoUrl={workspaceLogoUrl(workspace)} userName={user.name} />;
}

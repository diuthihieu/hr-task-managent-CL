import { requireWorkspacePage } from "@/lib/page-context";
import { AgentWorkHub } from "@/components/agent-work/agent-work-hub";

export const metadata = { title: "Agent Work" };

export default async function AgentWorkPage({ params, searchParams }: { params: Promise<{ workspaceSlug: string }>; searchParams: Promise<{ run?: string }> }) {
  const { workspaceSlug } = await params;
  const { run } = await searchParams;
  const { workspace } = await requireWorkspacePage(workspaceSlug);
  return <AgentWorkHub workspaceId={workspace.id} workspaceName={workspace.name} initialRunId={run ?? null} />;
}

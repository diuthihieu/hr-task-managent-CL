import { requireWorkspacePage } from "@/lib/page-context";
import { KnowledgeGraphView } from "@/components/graph/knowledge-graph-view";

export const metadata = { title: "Graph view" };

const FOCUS = /^(wiki|task|project|objective|kr|person|tag|file):[0-9a-f-]{36}$/i;

export default async function WikiGraphPage({ params, searchParams }: { params: Promise<{ workspaceSlug: string }>; searchParams: Promise<{ focus?: string; mode?: string }> }) {
  const { workspaceSlug } = await params;
  const { focus, mode } = await searchParams;
  const { workspace } = await requireWorkspacePage(workspaceSlug);
  const initialFocus = focus && FOCUS.test(focus) ? focus.toLowerCase() : undefined;
  return <KnowledgeGraphView workspaceId={workspace.id} initialFocus={initialFocus} initialMode={mode === "local" || mode === "global" ? mode : undefined} />;
}

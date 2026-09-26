import { requireWorkspacePage } from "@/lib/page-context";
import { OkrListWorkspace } from "@/components/okr/okr-list-workspace";

export default async function MyOkrsPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireWorkspacePage(workspaceSlug);

  return <OkrListWorkspace workspaceId={workspace.id} workspaceSlug={workspaceSlug} scope="mine" />;
}

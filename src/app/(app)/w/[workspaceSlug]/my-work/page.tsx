import { requireWorkspacePage } from "@/lib/page-context";
import { MyWork } from "@/components/okr/my-work";

export default async function MyWorkPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireWorkspacePage(workspaceSlug);

  return <MyWork workspaceId={workspace.id} workspaceSlug={workspaceSlug} />;
}

import { requireWorkspacePage } from "@/lib/page-context";
import { KudosLetter } from "@/components/recognition/kudos-letter";

export const metadata = { title: "Kudos" };

export default async function KudosPage({ params }: { params: Promise<{ workspaceSlug: string; kudosId: string }> }) {
  const { workspaceSlug, kudosId } = await params;
  const { user, workspace } = await requireWorkspacePage(workspaceSlug);
  return <KudosLetter workspaceId={workspace.id} workspaceSlug={workspaceSlug} kudosId={kudosId} me={{ id: user.id, name: user.name }} />;
}

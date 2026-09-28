import type { Metadata } from "next";
import { requireWikiPage } from "@/lib/page-context";
import { WikiWorkspace } from "@/components/wiki/wiki-workspace";

export const metadata: Metadata = { title: "Wiki" };

export default async function WikiRoute({ params }: { params: Promise<{ workspaceSlug: string; wikiId: string }> }) {
  const { workspaceSlug, wikiId } = await params;
  const { user, workspace, wiki } = await requireWikiPage(workspaceSlug, wikiId);
  return <WikiWorkspace key={wiki.id} wiki={wiki} workspaceSlug={workspaceSlug} workspaceId={workspace.id} pageId={null} currentUserName={user.name} />;
}

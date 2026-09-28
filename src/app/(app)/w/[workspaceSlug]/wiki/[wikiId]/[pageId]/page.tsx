import type { Metadata } from "next";
import { requireWikiPage } from "@/lib/page-context";
import { WikiWorkspace } from "@/components/wiki/wiki-workspace";

export const metadata: Metadata = { title: "Wiki" };

export default async function WikiPageRoute({ params }: { params: Promise<{ workspaceSlug: string; wikiId: string; pageId: string }> }) {
  const { workspaceSlug, wikiId, pageId } = await params;
  const { user, workspace, wiki } = await requireWikiPage(workspaceSlug, wikiId);
  return <WikiWorkspace key={wiki.id} wiki={wiki} workspaceSlug={workspaceSlug} workspaceId={workspace.id} pageId={pageId} currentUserName={user.name} />;
}

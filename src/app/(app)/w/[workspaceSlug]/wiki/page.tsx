import { prisma } from "@/lib/prisma";
import { requireWorkspacePage } from "@/lib/page-context";
import { visibleWikiWhere, wikiRoleOf, roleAtLeast } from "@/lib/authz";
import { serializeWiki, WIKI_SELECT } from "@/lib/wiki";
import { WikiHome } from "@/components/wiki/wiki-home";

export const metadata = { title: "Wiki" };

export default async function WikiListPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { user, workspace, role } = await requireWorkspacePage(workspaceSlug);
  const wikis = await prisma.wiki.findMany({ where: { workspaceId: workspace.id, ...visibleWikiWhere(user, role) }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: WIKI_SELECT });
  const rows = (await Promise.all(wikis.map(async (w) => serializeWiki(w, await wikiRoleOf(user, w.id, role))))).filter((w) => w.myRole);
  return <WikiHome workspaceId={workspace.id} workspaceSlug={workspaceSlug} wikis={rows} canCreate={roleAtLeast(role, "contributor")} />;
}

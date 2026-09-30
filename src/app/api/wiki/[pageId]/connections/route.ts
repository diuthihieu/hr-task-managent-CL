import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, workspaceOfWikiPage } from "@/lib/authz";
import { brainAccess } from "@/lib/brain/access";
import { backlinksTo, outgoingLinks, relatedPages, unlinkedMentions } from "@/lib/brain/connections";

type P = { pageId: string };

/**
 * Everything connected to a wiki page, derived from existing content and
 * relations: backlinks (with the linking sentence and block), unlinked
 * mentions, outgoing links (broken ones flagged), related pages and decisions.
 */
export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { pageId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfWikiPage(pageId), "viewer");
  const access = await brainAccess(user, ctx.workspaceId, ctx.role);
  const [page, ws] = await Promise.all([
    prisma.wikiPage.findUniqueOrThrow({ where: { id: pageId }, select: { id: true, title: true, tags: true, content: true, sourceProjectIds: true, parentPageId: true } }),
    prisma.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId }, select: { slug: true } }),
  ]);
  const base = `/w/${ws.slug}`;
  const [backlinks, unlinked, outgoing] = await Promise.all([backlinksTo(access, base, pageId), unlinkedMentions(access, base, page), outgoingLinks(access, base, page.content)]);
  const related = await relatedPages(access, base, page, backlinks.filter((b) => b.type === "wiki").map((b) => b.id));
  return NextResponse.json({ backlinks, unlinked, outgoing, related });
});

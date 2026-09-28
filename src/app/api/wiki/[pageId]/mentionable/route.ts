import { NextResponse } from "next/server";
import { requireUser, requireWorkspaceRole, route, workspaceOfWikiPage } from "@/lib/authz";
import { wikiReaders } from "@/lib/wiki-comments";

type P = { pageId: string };

/** People who can open this wiki page - the ones a comment can @mention. */
export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { pageId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfWikiPage(pageId), "viewer");
  return NextResponse.json(await wikiReaders(ctx.wikiId!, ctx.workspaceId));
});

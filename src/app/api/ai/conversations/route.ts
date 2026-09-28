import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, requireWiki, route, badRequest } from "@/lib/authz";
import { aiConfigured } from "@/lib/ai/gemini";

/** The caller's own conversations: ?workspaceId=&kind=assistant or ?wikiId=&kind=wiki. */
export const GET = route(async (req) => {
  const user = await requireUser();
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") === "wiki" ? "wiki" : "assistant";
  const wikiId = url.searchParams.get("wikiId");
  let workspaceId = url.searchParams.get("workspaceId");
  if (kind === "wiki") {
    if (!wikiId) throw badRequest("wikiId is required");
    workspaceId = (await requireWiki(user, wikiId, "viewer")).workspaceId;
  } else {
    if (!workspaceId) throw badRequest("workspaceId is required");
    await requireWorkspaceRole(user, workspaceId, "viewer");
  }
  const rows = await prisma.aiConversation.findMany({
    where: { userId: user.id, workspaceId, kind, ...(kind === "wiki" ? { wikiId } : {}) },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: { id: true, title: true, updatedAt: true },
  });
  return NextResponse.json({ configured: aiConfigured(), items: rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() })) });
});

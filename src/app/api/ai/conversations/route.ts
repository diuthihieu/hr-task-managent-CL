import { NextResponse } from "next/server";
import type { WorkspaceRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, requireWiki, route, badRequest, visibleProjectWhere, visibleWikiWhere } from "@/lib/authz";
import { aiConfigured } from "@/lib/ai/gemini";

/** The caller's own conversations. `all=1` returns unified cross-origin history. */
export const GET = route(async (req) => {
  const user = await requireUser();
  const url = new URL(req.url);
  const all = url.searchParams.get("all") === "1";
  const kind = url.searchParams.get("kind") === "wiki" ? "wiki" : "assistant";
  const wikiId = url.searchParams.get("wikiId");
  let workspaceId = url.searchParams.get("workspaceId");
  let workspaceRole: WorkspaceRole;
  if (all) {
    if (!workspaceId) throw badRequest("workspaceId is required");
    workspaceRole = (await requireWorkspaceRole(user, workspaceId, "viewer")).role;
  } else if (kind === "wiki") {
    if (!wikiId) throw badRequest("wikiId is required");
    const ctx = await requireWiki(user, wikiId, "viewer");
    workspaceId = ctx.workspaceId;
    workspaceRole = ctx.role;
  } else {
    if (!workspaceId) throw badRequest("workspaceId is required");
    workspaceRole = (await requireWorkspaceRole(user, workspaceId, "viewer")).role;
  }
  const rows = await prisma.aiConversation.findMany({
    where: {
      userId: user.id,
      workspaceId,
      ...(!all ? { kind, ...(kind === "wiki" ? { wikiId } : {}) } : {}),
      AND: [
        { OR: [{ projectId: null }, { project: { deletedAt: null, ...visibleProjectWhere(user) } }] },
        { OR: [{ wikiId: null }, { wiki: visibleWikiWhere(user, workspaceRole) }] },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: { id: true, title: true, kind: true, originType: true, originId: true, updatedAt: true, project: { select: { id: true, name: true } }, task: { select: { id: true, title: true } }, skill: { select: { id: true, name: true } }, agentRun: { select: { id: true, status: true } } },
  });
  return NextResponse.json({ configured: aiConfigured(), items: rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() })) });
});

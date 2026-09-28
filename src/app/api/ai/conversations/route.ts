import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, workspaceOfProject, badRequest } from "@/lib/authz";
import { aiConfigured } from "@/lib/ai/gemini";

/** The caller's own conversations: ?workspaceId=&kind=assistant or ?projectId=&kind=wiki. */
export const GET = route(async (req) => {
  const user = await requireUser();
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") === "wiki" ? "wiki" : "assistant";
  const projectId = url.searchParams.get("projectId");
  let workspaceId = url.searchParams.get("workspaceId");
  if (kind === "wiki") {
    if (!projectId) throw badRequest("projectId is required");
    workspaceId = (await requireWorkspaceRole(user, await workspaceOfProject(projectId), "viewer")).workspaceId;
  } else {
    if (!workspaceId) throw badRequest("workspaceId is required");
    await requireWorkspaceRole(user, workspaceId, "viewer");
  }
  const rows = await prisma.aiConversation.findMany({
    where: { userId: user.id, workspaceId, kind, ...(kind === "wiki" ? { projectId } : {}) },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: { id: true, title: true, updatedAt: true },
  });
  return NextResponse.json({ configured: aiConfigured(), items: rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() })) });
});

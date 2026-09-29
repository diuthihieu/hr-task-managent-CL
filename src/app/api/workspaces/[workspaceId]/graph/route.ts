import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, badRequest } from "@/lib/authz";
import { buildKnowledgeGraph, localSubgraph } from "@/lib/knowledge-graph";

type P = { workspaceId: string };

/**
 * Knowledge graph of the workspace, limited to what the caller may see.
 * ?focus=<type>:<id>&depth=1..3 returns the local graph around that node.
 */
export const GET = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  const ctx = await requireWorkspaceRole(user, workspaceId, "viewer");
  const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { id: true, slug: true } });
  const url = new URL(req.url);
  const focus = url.searchParams.get("focus");
  const depth = Number(url.searchParams.get("depth") ?? 2);
  if (focus && !/^(wiki|task|project|objective|kr|person|tag|file):[0-9a-f-]{36}$/i.test(focus)) throw badRequest("Invalid focus node");
  if (!Number.isInteger(depth) || depth < 1 || depth > 3) throw badRequest("depth must be 1, 2 or 3");
  const graph = await buildKnowledgeGraph(user, ws, ctx.role);
  return NextResponse.json(focus ? localSubgraph(graph, focus.toLowerCase(), depth) : graph);
});

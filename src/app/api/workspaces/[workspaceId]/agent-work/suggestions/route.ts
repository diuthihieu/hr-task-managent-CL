import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, requireWorkspaceRole, route, readJson } from "@/lib/authz";
import { detectAgentSuggestions, listAgentSuggestions } from "@/lib/agent-work/engine";

type P = { workspaceId: string };
const schema = z.object({ manual: z.boolean().default(false) });

export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "viewer");
  return NextResponse.json(await listAgentSuggestions(user, workspaceId));
});

export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "viewer");
  const body = schema.parse(await readJson(req));
  return NextResponse.json(await detectAgentSuggestions(user, workspaceId, body.manual));
});

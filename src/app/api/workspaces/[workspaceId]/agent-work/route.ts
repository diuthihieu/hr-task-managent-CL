import { NextResponse } from "next/server";
import { requireUser, requireWorkspaceRole, route } from "@/lib/authz";
import { getAgentWorkSnapshot } from "@/lib/agent-work/engine";

type P = { workspaceId: string };

export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "viewer");
  return NextResponse.json(await getAgentWorkSnapshot(user, workspaceId));
});


import { NextResponse } from "next/server";
import { requireUser, route, readJson } from "@/lib/authz";
import { createWorkflow, listWorkflows, workflowBody } from "@/lib/agent-work/workflows";

type P = { workspaceId: string };

/** My scheduled workflows in this workspace. */
export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  return NextResponse.json(await listWorkflows(user, workspaceId));
});

export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  return NextResponse.json(await createWorkflow(user, workspaceId, workflowBody.parse(await readJson(req))), { status: 201 });
});

import { NextResponse } from "next/server";
import { requireUser, requireWorkspaceRole, assertCanEditTask, route, workspaceOfTask } from "@/lib/authz";

type P = { taskId: string };

/** Authorized prefix used by direct-to-Blob task uploads. */
export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { taskId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfTask(taskId), "contributor");
  await assertCanEditTask(ctx, taskId);
  return NextResponse.json({ pathname: `workspaces/${ctx.workspaceId}/tasks/${taskId}/`, access: process.env.BLOB_ACCESS === "public" ? "public" : "private" });
});

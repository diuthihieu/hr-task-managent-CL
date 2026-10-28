import { NextResponse } from "next/server";
import { requireUser, requireWorkspaceRole, route, notFound } from "@/lib/authz";
import { findDeletedTask, restoreTask } from "@/server/tasks/mutations";

type P = { taskId: string };

export const POST = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { taskId } = await params;
  const task = await findDeletedTask(taskId);
  if (!task) throw notFound("Deleted task");
  const ctx = await requireWorkspaceRole(user, task.workspaceId, "editor");
  return NextResponse.json(await restoreTask(ctx, taskId, task.title));
});

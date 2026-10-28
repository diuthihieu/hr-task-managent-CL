import { NextResponse } from "next/server";
import { requireUser, requireWorkspaceRole, route, notFound, assertCanDeleteTask } from "@/lib/authz";
import { findDeletedTask, restoreTask } from "@/server/tasks/mutations";

type P = { taskId: string };

export const POST = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { taskId } = await params;
  const task = await findDeletedTask(taskId);
  if (!task) throw notFound("Deleted task");
  // Scope with the project (404 when it's hidden from the caller), then the same right as deleting.
  const ctx = await requireWorkspaceRole(user, { workspaceId: task.workspaceId, projectId: task.projectId }, "editor");
  await assertCanDeleteTask(ctx, taskId);
  return NextResponse.json(await restoreTask(ctx, taskId, task.title));
});

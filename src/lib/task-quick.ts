import { prisma } from "@/lib/prisma";
import { requireWorkspaceRole, assertCanEditTask, workspaceOfTask, badRequest, type SessionUser } from "@/lib/authz";
import { applyTaskPatch, SYS } from "@/lib/task-grid";
import { notifyTaskPatched } from "@/lib/notifications";
import { logActivity } from "@/lib/activity";

export type QuickTaskAction = "complete" | "start" | "plan" | "reopen";

const SUMMARY: Record<QuickTaskAction, string> = {
  complete: "Marked done",
  start: "Started",
  plan: "Planned for today",
  reopen: "Reopened",
};

/**
 * One-click task actions (Home, gallery cards, Action Center): complete ->
 * first "done" status, start -> first "in progress" status, reopen -> first
 * "to do" status, plan -> start date = today. Same permission checks,
 * notifications and activity log as an edit in the grid.
 */
export async function quickTaskAction(user: SessionUser, taskId: string, action: QuickTaskAction, via?: string) {
  const ctx = await requireWorkspaceRole(user, await workspaceOfTask(taskId), "contributor");
  await assertCanEditTask(ctx, taskId);
  let data: Record<string, unknown>;
  if (action === "plan") {
    data = { [SYS.startDate]: new Date().toISOString().slice(0, 10) };
  } else {
    const category = action === "complete" ? "done" : action === "start" ? "in_progress" : "todo";
    const status = await prisma.status.findFirst({ where: { workspaceId: ctx.workspaceId, category }, orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }] });
    if (!status) throw badRequest(`This workspace has no '${category.replace("_", " ")}' status`);
    data = { [SYS.status]: status.id };
  }
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, select: { projectId: true, title: true } });
  await prisma.$transaction(async (tx) => {
    const res = await applyTaskPatch(tx, { taskId, projectId: task.projectId, workspaceId: ctx.workspaceId, actorId: user.id, data });
    if (!Object.keys(res.changes).length) return;
    await notifyTaskPatched(tx, { taskId, actorId: user.id, changedKeys: Object.keys(res.changes), statusChanged: res.statusChanged, newStatusName: res.newStatusName, assigned: [], reportAdded: [] });
    await logActivity(tx, {
      workspaceId: ctx.workspaceId,
      actorId: user.id,
      entityType: "task",
      entityId: taskId,
      action: res.statusChanged ? "status_changed" : "updated",
      changes: res.changes,
      summary: `${SUMMARY[action]} "${task.title}"${via ? ` from ${via}` : ""}`,
    });
  });
}

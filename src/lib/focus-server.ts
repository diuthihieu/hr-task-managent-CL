import "server-only";
import type { FocusSession, Prisma } from "@prisma/client";
import { assertCanEditTask, requireWorkspaceRole, roleAtLeast, workspaceOfTask, type SessionUser } from "./authz";
import { applyTaskPatch, SYS } from "./task-grid";
import { logActivity } from "./activity";
import { notifyTaskPatched } from "./notifications";
import { focusElapsed } from "./focus";

type Tx = Prisma.TransactionClient;

/** Access to a session's task: null when it's gone or hidden; canEdit when focused time may be added to it. */
export async function focusAccess(user: SessionUser, taskId: string) {
  const access = await requireWorkspaceRole(user, await workspaceOfTask(taskId), "viewer").catch(() => null);
  const canEdit = access && roleAtLeast(access.role, "contributor") ? await assertCanEditTask(access, taskId).then(() => true, () => false) : false;
  return { access, canEdit };
}

/**
 * Adds the not-yet-recorded focus time to the task's actual time. Called
 * whenever a run stops (pause, switching to another task, stop, complete), so
 * leaving a task without "Complete" still counts the work.
 */
export async function recordFocusTime(tx: Tx, s: Pick<FocusSession, "id" | "taskId" | "recordedSeconds">, elapsedSeconds: number, actorId: string, canEdit: boolean, final = false) {
  if (!canEdit) return 0;
  const toMinutes = (sec: number) => Math.round(sec / 60);
  const total = final && elapsedSeconds > 0 ? Math.max(1, toMinutes(elapsedSeconds)) : toMinutes(elapsedSeconds);
  const add = Math.max(0, total - toMinutes(s.recordedSeconds));
  await tx.focusSession.update({ where: { id: s.id }, data: { recordedSeconds: Math.max(s.recordedSeconds, elapsedSeconds) } });
  if (!add) return 0;
  const task = await tx.task.findUniqueOrThrow({ where: { id: s.taskId }, select: { actualMinutes: true, workspaceId: true } });
  const to = (task.actualMinutes ?? 0) + add;
  await tx.task.update({ where: { id: s.taskId }, data: { actualMinutes: to, updatedById: actorId } });
  await logActivity(tx, { workspaceId: task.workspaceId, actorId, entityType: "task", entityId: s.taskId, action: "updated", summary: `Focused ${add} min`, changes: { actualMinutes: { from: task.actualMinutes, to } } });
  return add;
}

/** Pauses the caller's other running sessions, recording their time. */
export async function pauseOtherRuns(tx: Tx, user: SessionUser, exceptId: string | null, now: Date) {
  const running = await tx.focusSession.findMany({ where: { userId: user.id, status: "running", ...(exceptId ? { id: { not: exceptId } } : {}) } });
  for (const o of running) {
    const elapsed = focusElapsed(o, now);
    await tx.focusSession.update({ where: { id: o.id }, data: { status: "paused", elapsedSeconds: elapsed, resumedAt: null } });
    const { canEdit } = await focusAccess(user, o.taskId);
    await recordFocusTime(tx, o, elapsed, user.id, canEdit);
  }
}

/** Focusing on a to-do task moves it to the first "in progress" status (when the user may edit it). */
export async function markInProgress(tx: Tx, taskId: string, actorId: string, canEdit: boolean) {
  if (!canEdit) return;
  const task = await tx.task.findUniqueOrThrow({ where: { id: taskId }, select: { projectId: true, workspaceId: true, status: { select: { category: true } } } });
  if (task.status.category !== "todo") return;
  const next = await tx.status.findFirst({ where: { workspaceId: task.workspaceId, category: "in_progress" }, orderBy: { sortOrder: "asc" }, select: { id: true } });
  if (!next) return;
  const res = await applyTaskPatch(tx, { taskId, projectId: task.projectId, workspaceId: task.workspaceId, actorId, data: { [SYS.status]: next.id } });
  if (Object.keys(res.changes).length) await notifyTaskPatched(tx, { taskId, actorId, changedKeys: Object.keys(res.changes), statusChanged: res.statusChanged, newStatusName: res.newStatusName, assigned: [], reportAdded: [] });
}

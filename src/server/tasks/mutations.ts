// Creating, editing, deleting and restoring a task with everything that goes with it
// (notifications, activity log), each in one transaction. The route has already checked
// the caller's rights (requireWorkspaceRole + assertCanEditTask / assertProjectCap ...).
import "server-only";
import { prisma } from "@/lib/prisma";
import type { WorkspaceContext } from "@/lib/authz";
import { notifyTaskCreated, notifyTaskPatched } from "@/lib/notifications";
import { logActivity } from "@/lib/activity";
import { doneMissing } from "@/lib/done-check";
import { loadTaskRecord } from "./read";
import { applyTaskPatch, createTask } from "./write";

export async function createTaskInProject(ctx: WorkspaceContext, projectId: string, data: Record<string, unknown>) {
  const actorId = ctx.user.id;
  return prisma.$transaction(async (tx) => {
    const taskId = await createTask(tx, { projectId, workspaceId: ctx.workspaceId, actorId, data });
    await notifyTaskCreated(tx, taskId, actorId);
    const rec = await loadTaskRecord(taskId, tx);
    await logActivity(tx, { workspaceId: ctx.workspaceId, actorId, entityType: "task", entityId: taskId, action: "created", summary: `Created task "${rec?.data.sys_title}"` });
    return rec;
  });
}

/**
 * Applies a cell patch and / or a new sort order. When the task has just been finished, the
 * result also lists which details are still empty (`doneMissing`) so the client can ask for them.
 */
export async function updateTask(ctx: WorkspaceContext, taskId: string, body: { data?: Record<string, unknown>; order?: number }) {
  const actorId = ctx.user.id;
  let becameDone = false;
  const record = await prisma.$transaction(async (tx) => {
    const task = await tx.task.findUniqueOrThrow({ where: { id: taskId }, select: { projectId: true, title: true } });
    if (body.order !== undefined) await tx.task.update({ where: { id: taskId }, data: { sortOrder: body.order } });
    if (body.data && Object.keys(body.data).length) {
      const res = await applyTaskPatch(tx, { taskId, projectId: task.projectId, workspaceId: ctx.workspaceId, actorId, data: body.data });
      becameDone = res.becameDone;
      if (Object.keys(res.changes).length || res.assigned.length || res.reportAdded.length) {
        await notifyTaskPatched(tx, {
          taskId,
          actorId,
          changedKeys: Object.keys(res.changes),
          statusChanged: res.statusChanged,
          newStatusName: res.newStatusName,
          assigned: res.assigned,
          reportAdded: res.reportAdded,
          newDueDate: res.changes.dueDate ? ((res.changes.dueDate as { to: string | null }).to ?? null) : undefined,
        });
      }
      if (Object.keys(res.changes).length) {
        await logActivity(tx, {
          workspaceId: ctx.workspaceId,
          actorId,
          entityType: "task",
          entityId: taskId,
          action: res.statusChanged ? "status_changed" : res.assigned.length || res.unassigned.length ? "assigned" : "updated",
          summary: `Updated "${task.title}": ${Object.keys(res.changes).join(", ")}`,
          changes: res.changes,
        });
      }
    }
    return loadTaskRecord(taskId, tx);
  });
  return becameDone && record ? { ...record, doneMissing: doneMissing(record.data) } : record;
}

/** Soft delete: the row stays and editors can restore it. */
export async function softDeleteTask(ctx: WorkspaceContext, taskId: string) {
  await prisma.$transaction(async (tx) => {
    const t = await tx.task.update({ where: { id: taskId }, data: { deletedAt: new Date(), deletedById: ctx.user.id } });
    await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: ctx.user.id, entityType: "task", entityId: taskId, action: "deleted", summary: `Deleted task "${t.title}"` });
  });
}

/** A deleted task in a live project (to restore it), or null. */
export async function findDeletedTask(taskId: string) {
  return prisma.task.findFirst({ where: { id: taskId, deletedAt: { not: null }, project: { deletedAt: null } }, select: { workspaceId: true, title: true } });
}

export async function restoreTask(ctx: WorkspaceContext, taskId: string, title: string) {
  return prisma.$transaction(async (tx) => {
    await tx.task.update({ where: { id: taskId }, data: { deletedAt: null, deletedById: null, updatedById: ctx.user.id } });
    await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: ctx.user.id, entityType: "task", entityId: taskId, action: "restored", summary: `Restored task "${title}"` });
    return loadTaskRecord(taskId, tx);
  });
}

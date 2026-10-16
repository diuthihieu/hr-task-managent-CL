import { NextResponse } from "next/server";
import { doneMissing } from "@/lib/done-check";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, assertCanEditTask, assertCanDeleteTask, route, readJson, workspaceOfTask, notFound } from "@/lib/authz";
import { notifyTaskPatched } from "@/lib/notifications";
import { logActivity } from "@/lib/activity";
import { applyTaskPatch, loadTaskRecord } from "@/lib/task-grid";

type P = { taskId: string };

export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { taskId } = await params;
  await requireWorkspaceRole(user, await workspaceOfTask(taskId), "viewer");
  const record = await loadTaskRecord(taskId);
  if (!record) throw notFound("Task");
  return NextResponse.json(record);
});

const patchSchema = z.object({
  data: z.record(z.string(), z.unknown()).optional(),
  order: z.number().finite().optional(),
});

export const PATCH = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { taskId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfTask(taskId), "contributor");
  await assertCanEditTask(ctx, taskId);
  const body = patchSchema.parse(await readJson(req));
  let becameDone = false;
  const record = await prisma.$transaction(async (tx) => {
    const task = await tx.task.findUniqueOrThrow({ where: { id: taskId }, select: { projectId: true, title: true } });
    if (body.order !== undefined) await tx.task.update({ where: { id: taskId }, data: { sortOrder: body.order } });
    if (body.data && Object.keys(body.data).length) {
      const res = await applyTaskPatch(tx, { taskId, projectId: task.projectId, workspaceId: ctx.workspaceId, actorId: user.id, data: body.data });
      becameDone = res.becameDone;
      if (Object.keys(res.changes).length || res.assigned.length || res.reportAdded.length) {
        await notifyTaskPatched(tx, {
          taskId,
          actorId: user.id,
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
          actorId: user.id,
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
  // Just finished: tell the client which details are still empty so it can ask for them.
  return NextResponse.json(becameDone && record ? { ...record, doneMissing: doneMissing(record.data) } : record);
});

/** Soft delete (restorable via POST /api/tasks/[id]/restore). */
export const DELETE = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { taskId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfTask(taskId), "contributor");
  await assertCanDeleteTask(ctx, taskId);
  await prisma.$transaction(async (tx) => {
    const t = await tx.task.update({ where: { id: taskId }, data: { deletedAt: new Date(), deletedById: user.id } });
    await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "task", entityId: taskId, action: "deleted", summary: `Deleted task "${t.title}"` });
  });
  return new NextResponse(null, { status: 204 });
});

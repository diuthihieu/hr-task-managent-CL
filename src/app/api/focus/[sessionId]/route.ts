import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, assertCanEditTask, route, readJson, notFound, badRequest, forbidden, roleAtLeast, workspaceOfTask } from "@/lib/authz";
import { applyTaskPatch, SYS } from "@/lib/task-grid";
import { logActivity } from "@/lib/activity";
import { notifyTaskPatched } from "@/lib/notifications";
import { focusElapsed, serializeFocus, FOCUS_TASK_SELECT } from "@/lib/focus";

type P = { sessionId: string };

const schema = z.object({
  action: z.enum(["pause", "resume", "complete", "cancel"]).optional(),
  notes: z.string().max(20000).optional(),
  checklist: z.array(z.object({ text: z.string().trim().min(1).max(300), done: z.boolean() })).max(100).optional(),
  plannedMinutes: z.number().int().min(1).max(12 * 60).optional(),
  /** With action=complete: also mark the task done. */
  completeTask: z.boolean().optional(),
});

/**
 * Pause / resume / complete / cancel a focus session, or save its notes and
 * checklist. Completing adds the focused minutes to the task's actual time.
 */
export const PATCH = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { sessionId } = await params;
  const body = schema.parse(await readJson(req));
  const s = await prisma.focusSession.findFirst({ where: { id: sessionId, userId: user.id } });
  if (!s) throw notFound("Focus session");
  // Re-check access on every change: someone removed from the workspace or hidden
  // from the project can only cancel an old session, never touch the task.
  const access = await requireWorkspaceRole(user, await workspaceOfTask(s.taskId), "viewer").catch(() => null);
  if (!access && body.action !== "cancel") throw notFound("Focus session");
  // Adding focused time to the task needs edit rights on it (viewers keep a personal record only).
  const canEdit = access && roleAtLeast(access.role, "contributor") ? await assertCanEditTask(access, s.taskId).then(() => true, () => false) : false;
  if ((s.status === "completed" || s.status === "cancelled") && body.action) throw badRequest("This focus session has ended");
  const now = new Date();
  const elapsed = focusElapsed(s, now);

  const updated = await prisma.$transaction(async (tx) => {
    const data: Record<string, unknown> = {};
    if (body.notes !== undefined) data.notes = body.notes;
    if (body.checklist !== undefined) data.checklist = body.checklist;
    if (body.plannedMinutes !== undefined) data.plannedMinutes = body.plannedMinutes;
    if (body.action === "pause" && s.status === "running") Object.assign(data, { status: "paused", elapsedSeconds: elapsed, resumedAt: null });
    if (body.action === "resume" && s.status === "paused") {
      // Only one running session at a time.
      const others = await tx.focusSession.findMany({ where: { userId: user.id, status: "running", id: { not: s.id } } });
      for (const o of others) await tx.focusSession.update({ where: { id: o.id }, data: { status: "paused", elapsedSeconds: focusElapsed(o, now), resumedAt: null } });
      Object.assign(data, { status: "running", resumedAt: now });
    }
    if (body.action === "cancel") Object.assign(data, { status: "cancelled", elapsedSeconds: elapsed, resumedAt: null, endedAt: now });
    if (body.action === "complete") {
      Object.assign(data, { status: "completed", elapsedSeconds: elapsed, resumedAt: null, endedAt: now });
      const minutes = Math.max(1, Math.round(elapsed / 60));
      const task = await tx.task.findUniqueOrThrow({ where: { id: s.taskId }, select: { actualMinutes: true, projectId: true, workspaceId: true } });
      if (canEdit) {
        await tx.task.update({ where: { id: s.taskId }, data: { actualMinutes: (task.actualMinutes ?? 0) + minutes, updatedById: user.id } });
        await logActivity(tx, { workspaceId: task.workspaceId, actorId: user.id, entityType: "task", entityId: s.taskId, action: "updated", summary: `Focused ${minutes} min`, changes: { actualMinutes: { from: task.actualMinutes, to: (task.actualMinutes ?? 0) + minutes } } });
      }
      if (body.completeTask) {
        if (!canEdit) throw forbidden("You can't change this task");
        const done = await tx.status.findFirst({ where: { workspaceId: task.workspaceId, category: "done" }, orderBy: { sortOrder: "asc" } });
        if (done) {
          const res = await applyTaskPatch(tx, { taskId: s.taskId, projectId: task.projectId, workspaceId: task.workspaceId, actorId: user.id, data: { [SYS.status]: done.id } });
          if (Object.keys(res.changes).length) await notifyTaskPatched(tx, { taskId: s.taskId, actorId: user.id, changedKeys: Object.keys(res.changes), statusChanged: res.statusChanged, newStatusName: res.newStatusName, assigned: [], reportAdded: [] });
        }
      }
    }
    return tx.focusSession.update({ where: { id: s.id }, data, include: { task: { select: FOCUS_TASK_SELECT } } });
  });
  return NextResponse.json(serializeFocus(updated, now));
});

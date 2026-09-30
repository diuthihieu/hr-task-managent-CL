import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, route, readJson, notFound, badRequest, forbidden } from "@/lib/authz";
import { applyTaskPatch, SYS } from "@/lib/task-grid";
import { notifyTaskPatched } from "@/lib/notifications";
import { focusElapsed, serializeFocus, FOCUS_TASK_SELECT } from "@/lib/focus";
import { focusAccess, recordFocusTime, pauseOtherRuns, markInProgress } from "@/lib/focus-server";

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
 * Pause / resume / complete / stop (action "cancel") a focus session, or save
 * its notes and checklist. Every time a run stops its minutes are added to the
 * task's actual time; "complete" can also mark the task done, "cancel" ends the
 * session and leaves the task in progress.
 */
export const PATCH = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { sessionId } = await params;
  const body = schema.parse(await readJson(req));
  const s = await prisma.focusSession.findFirst({ where: { id: sessionId, userId: user.id } });
  if (!s) throw notFound("Focus session");
  // Re-check access on every change: someone removed from the workspace or hidden
  // from the project can only cancel an old session, never touch the task.
  // Adding focused time to the task needs edit rights on it (viewers keep a personal record only).
  const { access, canEdit } = await focusAccess(user, s.taskId);
  if (!access && body.action !== "cancel") throw notFound("Focus session");
  if ((s.status === "completed" || s.status === "cancelled") && body.action) throw badRequest("This focus session has ended");
  const now = new Date();
  const elapsed = focusElapsed(s, now);

  const updated = await prisma.$transaction(async (tx) => {
    const data: Record<string, unknown> = {};
    if (body.notes !== undefined) data.notes = body.notes;
    if (body.checklist !== undefined) data.checklist = body.checklist;
    if (body.plannedMinutes !== undefined) data.plannedMinutes = body.plannedMinutes;
    if (body.action === "pause" && s.status === "running") {
      Object.assign(data, { status: "paused", elapsedSeconds: elapsed, resumedAt: null });
      await recordFocusTime(tx, s, elapsed, user.id, canEdit);
    }
    if (body.action === "resume" && s.status === "paused") {
      // Only one running session at a time: the others pause (and their time is recorded).
      await pauseOtherRuns(tx, user, s.id, now);
      Object.assign(data, { status: "running", resumedAt: now });
      await markInProgress(tx, s.taskId, user.id, canEdit);
    }
    if (body.action === "cancel") {
      Object.assign(data, { status: "cancelled", elapsedSeconds: elapsed, resumedAt: null, endedAt: now });
      if (access) await recordFocusTime(tx, s, elapsed, user.id, canEdit);
    }
    if (body.action === "complete") {
      Object.assign(data, { status: "completed", elapsedSeconds: elapsed, resumedAt: null, endedAt: now });
      const task = await tx.task.findUniqueOrThrow({ where: { id: s.taskId }, select: { projectId: true, workspaceId: true } });
      await recordFocusTime(tx, s, elapsed, user.id, canEdit, true);
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

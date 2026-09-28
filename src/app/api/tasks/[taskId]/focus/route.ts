import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfTask } from "@/lib/authz";
import { focusElapsed, serializeFocus, FOCUS_TASK_SELECT } from "@/lib/focus";

type P = { taskId: string };

/** Focus history of a task: sessions and total focused minutes. */
export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { taskId } = await params;
  await requireWorkspaceRole(user, await workspaceOfTask(taskId), "viewer");
  const sessions = await prisma.focusSession.findMany({ where: { taskId, status: { not: "cancelled" } }, orderBy: { startedAt: "desc" }, take: 50, include: { user: { select: { name: true } } } });
  const now = new Date();
  return NextResponse.json({
    totalMinutes: Math.round(sessions.reduce((s, x) => s + focusElapsed(x, now), 0) / 60),
    sessions: sessions.map((s) => ({ id: s.id, user: s.user.name, status: s.status, minutes: Math.round(focusElapsed(s, now) / 60), plannedMinutes: s.plannedMinutes, startedAt: s.startedAt.toISOString(), endedAt: s.endedAt?.toISOString() ?? null })),
  });
});

const schema = z.object({ plannedMinutes: z.number().int().min(1).max(12 * 60).nullable().optional() });

/** Start focusing on this task. Any other active session of yours is paused first. */
export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { taskId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfTask(taskId), "viewer");
  const body = schema.parse(await readJson(req).catch(() => ({})));
  const now = new Date();
  const session = await prisma.$transaction(async (tx) => {
    const active = await tx.focusSession.findMany({ where: { userId: user.id, status: "running" } });
    for (const a of active) await tx.focusSession.update({ where: { id: a.id }, data: { status: "paused", elapsedSeconds: focusElapsed(a, now), resumedAt: null } });
    const task = await tx.task.findUniqueOrThrow({ where: { id: taskId }, select: { estimateMinutes: true, actualMinutes: true } });
    // Default block: what's left of the estimate (25-minute block when there's no estimate).
    const left = task.estimateMinutes ? Math.max(5, task.estimateMinutes - (task.actualMinutes ?? 0)) : 25;
    return tx.focusSession.create({
      data: { workspaceId: ctx.workspaceId, taskId, userId: user.id, status: "running", resumedAt: now, plannedMinutes: body.plannedMinutes ?? Math.min(left, 240), checklist: [] },
      include: { task: { select: FOCUS_TASK_SELECT } },
    });
  });
  return NextResponse.json(serializeFocus(session, now), { status: 201 });
});

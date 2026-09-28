import type { FocusSession } from "@prisma/client";

/** Seconds counted so far, including the current run. */
export function focusElapsed(s: Pick<FocusSession, "status" | "elapsedSeconds" | "resumedAt">, now = new Date()) {
  const running = s.status === "running" && s.resumedAt ? Math.max(0, Math.floor((now.getTime() - s.resumedAt.getTime()) / 1000)) : 0;
  return s.elapsedSeconds + running;
}

export interface ChecklistItem {
  text: string;
  done: boolean;
}

export function serializeFocus(
  s: FocusSession & { task?: { id: string; title: string; projectId: string; estimateMinutes: number | null; actualMinutes: number | null; workspace: { slug: string } } },
  now = new Date()
) {
  return {
    id: s.id,
    taskId: s.taskId,
    status: s.status,
    plannedMinutes: s.plannedMinutes,
    elapsedSeconds: focusElapsed(s, now),
    running: s.status === "running",
    notes: s.notes ?? "",
    checklist: (Array.isArray(s.checklist) ? s.checklist : []) as unknown as ChecklistItem[],
    startedAt: s.startedAt.toISOString(),
    endedAt: s.endedAt?.toISOString() ?? null,
    serverTime: now.toISOString(),
    task: s.task
      ? { id: s.task.id, title: s.task.title, estimateMinutes: s.task.estimateMinutes, actualMinutes: s.task.actualMinutes, link: `/w/${s.task.workspace.slug}/p/${s.task.projectId}/t/${s.task.id}` }
      : null,
  };
}

export const FOCUS_TASK_SELECT = { id: true, title: true, projectId: true, estimateMinutes: true, actualMinutes: true, workspace: { select: { slug: true } } } as const;

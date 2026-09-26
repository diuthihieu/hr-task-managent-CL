// OKR progress math, shared by every API route that reads Objectives/Key
// Results. Progress is never stored - it's recomputed here every time from
// (a) a task-based KR's linked tasks, or (b) a numeric/percentage/manual KR's
// own value fields - so a Task edit is reflected the instant it's read back,
// with nothing to keep in sync and no write-fanout.

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n * 10) / 10));
}

/** A task's completion: 100 once its status is in the "done" category, otherwise its own progress value. */
export function resolveTaskProgress(task: { progress: number; statusCategory: string | null | undefined }): number {
  if (task.statusCategory === "done") return 100;
  return clamp(task.progress);
}

export interface KeyResultValueShape {
  type: string;
  startValue: number;
  targetValue: number;
  currentValue: number;
  manualProgress: number | null;
}

export function computeKeyResultProgress(kr: KeyResultValueShape, taskProgresses: { progress: number; weight: number }[]): number {
  if (kr.type === "manual") return clamp(kr.manualProgress ?? 0);
  if (kr.type === "percentage") return clamp(kr.currentValue);
  if (kr.type === "numeric") {
    const span = kr.targetValue - kr.startValue;
    if (span === 0) return kr.currentValue >= kr.targetValue ? 100 : 0;
    return clamp(((kr.currentValue - kr.startValue) / span) * 100);
  }
  // task_based (default)
  if (!taskProgresses.length) return 0;
  const totalWeight = taskProgresses.reduce((s, t) => s + t.weight, 0);
  if (totalWeight <= 0) return 0;
  const sum = taskProgresses.reduce((s, t) => s + t.progress * t.weight, 0);
  return clamp(sum / totalWeight);
}

export function computeObjectiveProgress(keyResults: { progress: number; weight: number }[]): number {
  if (!keyResults.length) return 0;
  const totalWeight = keyResults.reduce((s, k) => s + k.weight, 0);
  if (totalWeight <= 0) return clamp(keyResults.reduce((s, k) => s + k.progress, 0) / keyResults.length);
  return clamp(keyResults.reduce((s, k) => s + k.progress * k.weight, 0) / totalWeight);
}

/** Due-date-derived urgency, for the Eisenhower matrix's optional auto-urgency rule. */
export function deriveUrgencyFromDueDate(dueDate: string | null | undefined, withinDays: number): "urgent" | "not_urgent" {
  if (!dueDate) return "not_urgent";
  const due = new Date(dueDate).getTime();
  if (Number.isNaN(due)) return "not_urgent";
  const now = Date.now();
  const days = (due - now) / 86400000;
  return days <= withinDays ? "urgent" : "not_urgent";
}

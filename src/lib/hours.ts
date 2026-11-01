// Hours of work per task without double counting the task tree. A parent's estimate / actual is the
// total of the whole branch (it must be >= the sum of its sub-tasks), so a parent's own share is its
// value minus its direct sub-tasks' values; summing own shares gives each branch exactly once.

export interface HoursTask {
  id: string;
  parentTaskId: string | null;
  estimateMinutes: number | null;
  actualMinutes: number | null;
}

/** Own estimate / actual minutes per task id (never below 0). */
export function ownMinutes(tasks: HoursTask[]): Map<string, { est: number; act: number }> {
  const childSum = new Map<string, { est: number; act: number }>();
  const ids = new Set(tasks.map((t) => t.id));
  for (const t of tasks) {
    if (!t.parentTaskId || !ids.has(t.parentTaskId)) continue;
    const s = childSum.get(t.parentTaskId) ?? { est: 0, act: 0 };
    s.est += t.estimateMinutes ?? 0;
    s.act += t.actualMinutes ?? 0;
    childSum.set(t.parentTaskId, s);
  }
  return new Map(
    tasks.map((t) => {
      const c = childSum.get(t.id) ?? { est: 0, act: 0 };
      return [t.id, { est: Math.max(0, (t.estimateMinutes ?? 0) - c.est), act: Math.max(0, (t.actualMinutes ?? 0) - c.act) }];
    }),
  );
}

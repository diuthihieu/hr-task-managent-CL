// Client-safe: which "finished task" details are still empty once a task is done.

/** Fields a finished task should have: actual time, start, due and completed. */
export const DONE_CHECK_FIELDS = ["sys_actual", "sys_start_date", "sys_due_date", "sys_completed_at"] as const;
export type DoneCheckField = (typeof DONE_CHECK_FIELDS)[number];

export function doneMissing(data: Record<string, unknown>): DoneCheckField[] {
  return DONE_CHECK_FIELDS.filter((k) => {
    const v = data[k];
    if (k === "sys_actual") return v === null || v === undefined || v === "" || Number(v) <= 0;
    return v === null || v === undefined || v === "";
  });
}

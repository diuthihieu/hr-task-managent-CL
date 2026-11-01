import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type Db = Prisma.TransactionClient | typeof prisma;

export interface HoursConflict {
  parentId: string;
  parentTitle: string;
  /** Hours the parent has now and the least it needs (the sum of its sub-tasks); null when fine. */
  estimate: { current: number; min: number } | null;
  actual: { current: number; min: number } | null;
}

const toHours = (m: number) => Math.round((m / 60) * 100) / 100;
/** Hours to suggest for `minutes`, rounded up to 0.01 h so that, saved and stored as whole minutes again, it still covers them. */
const coverHours = (minutes: number) => Math.ceil((minutes / 60) * 100 - 1e-9) / 100;

async function check(db: Db, parentId: string): Promise<HoursConflict | null> {
  const parent = await db.task.findFirst({ where: { id: parentId, deletedAt: null }, select: { id: true, title: true, estimateMinutes: true, actualMinutes: true } });
  if (!parent) return null;
  const children = await db.task.findMany({ where: { parentTaskId: parentId, deletedAt: null }, select: { estimateMinutes: true, actualMinutes: true } });
  if (!children.length) return null;
  // Compared in stored minutes: rounding each sub-task to hours first can ask for a total that can't be saved.
  const short = (own: number | null, sum: number) => (own !== null && own < sum ? { current: toHours(own), min: coverHours(sum) } : null);
  const estimate = short(parent.estimateMinutes, children.reduce((n, c) => n + (c.estimateMinutes ?? 0), 0));
  const actual = short(parent.actualMinutes, children.reduce((n, c) => n + (c.actualMinutes ?? 0), 0));
  if (!estimate && !actual) return null;
  return { parentId: parent.id, parentTitle: parent.title, estimate, actual };
}

/**
 * After a task's hours or parent changed: does the task (as a parent) or its parent now have fewer
 * hours than its sub-tasks add up to? A parent's hours include its sub-tasks', so the client asks the
 * user to correct them. A parent with no hours at all is left alone (nothing entered yet).
 */
export async function hoursConflictAround(db: Db, taskId: string): Promise<HoursConflict | null> {
  const task = await db.task.findFirst({ where: { id: taskId, deletedAt: null }, select: { parentTaskId: true } });
  if (!task) return null;
  return (await check(db, taskId)) ?? (task.parentTaskId ? await check(db, task.parentTaskId) : null);
}

/** Only these edits can break the rule. */
export const HOURS_KEYS = ["sys_estimate", "sys_actual", "sys_parent"];

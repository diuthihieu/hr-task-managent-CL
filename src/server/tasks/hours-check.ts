import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hoursConflict } from "@/lib/hours";

type Db = Prisma.TransactionClient | typeof prisma;

export interface HoursConflict {
  parentId: string;
  parentTitle: string;
  /** Hours the parent has now and the least it needs (the sum of its sub-tasks); null when fine. */
  estimate: { current: number; min: number } | null;
  actual: { current: number; min: number } | null;
}

const toHours = (m: number | null) => (m === null ? null : Math.round((m / 60) * 100) / 100);

async function check(db: Db, parentId: string): Promise<HoursConflict | null> {
  const parent = await db.task.findFirst({ where: { id: parentId, deletedAt: null }, select: { id: true, title: true, estimateMinutes: true, actualMinutes: true } });
  if (!parent) return null;
  const children = await db.task.findMany({ where: { parentTaskId: parentId, deletedAt: null }, select: { estimateMinutes: true, actualMinutes: true } });
  if (!children.length) return null;
  const p = { estimate: toHours(parent.estimateMinutes), actual: toHours(parent.actualMinutes) };
  const c = hoursConflict(p, children.map((ch) => ({ estimate: toHours(ch.estimateMinutes), actual: toHours(ch.actualMinutes) })));
  if (c.estimate === null && c.actual === null) return null;
  return {
    parentId: parent.id,
    parentTitle: parent.title,
    estimate: c.estimate === null ? null : { current: p.estimate ?? 0, min: c.estimate },
    actual: c.actual === null ? null : { current: p.actual ?? 0, min: c.actual },
  };
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

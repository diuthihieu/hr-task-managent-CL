// Recurring tasks: the rule, the date arithmetic and creating the next occurrence.
import type { Prisma } from "@prisma/client";
import { badRequest } from "@/lib/http-errors";

type Tx = Prisma.TransactionClient;

export type RecurrenceRule = { freq: "daily" | "weekly" | "monthly"; interval: number };

export function parseRecurrence(value: unknown): RecurrenceRule | null {
  if (value === null || value === undefined || value === "") return null;
  const v = value as { freq?: unknown; interval?: unknown };
  if (typeof v !== "object" || !["daily", "weekly", "monthly"].includes(v.freq as string)) throw badRequest("Recurrence must be daily, weekly or monthly");
  const interval = v.interval === undefined ? 1 : Number(v.interval);
  if (!Number.isInteger(interval) || interval < 1 || interval > 365) throw badRequest("Recurrence interval must be 1-365");
  return { freq: v.freq as RecurrenceRule["freq"], interval };
}

/** Date `d` moved forward by one recurrence step (UTC date arithmetic, month ends clamp). */
export function addRecurrence(d: Date, rule: RecurrenceRule): Date {
  const out = new Date(d);
  if (rule.freq === "daily") out.setUTCDate(out.getUTCDate() + rule.interval);
  else if (rule.freq === "weekly") out.setUTCDate(out.getUTCDate() + 7 * rule.interval);
  else {
    const day = out.getUTCDate();
    out.setUTCDate(1);
    out.setUTCMonth(out.getUTCMonth() + rule.interval);
    const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
    out.setUTCDate(Math.min(day, last));
  }
  return out;
}

/**
 * Recurring tasks: completing one creates the next occurrence (same project,
 * details, people and OKR; dates moved by one step). Only once per task - a
 * reopened and re-completed occurrence doesn't create a second one.
 */
export async function spawnNextOccurrence(tx: Tx, taskId: string, actorId: string | null) {
  const t = await tx.task.findUniqueOrThrow({ where: { id: taskId }, include: { assignees: true, reportTo: true, recurrenceNext: { select: { id: true } } } });
  if (!t.recurrenceFreq || t.recurrenceNext || t.deletedAt) return;
  const rule: RecurrenceRule = { freq: t.recurrenceFreq, interval: t.recurrenceInterval ?? 1 };
  const today = new Date(new Date().toISOString().slice(0, 10));
  // Next due date: one step after the old one, and never in the past.
  let due = t.dueDate ? addRecurrence(t.dueDate, rule) : addRecurrence(today, rule);
  while (due < today) due = addRecurrence(due, rule);
  const shift = t.dueDate ? due.getTime() - t.dueDate.getTime() : 0;
  const start = t.startDate ? new Date(t.startDate.getTime() + shift) : null;
  const defaultStatus =
    (await tx.status.findFirst({ where: { workspaceId: t.workspaceId, isDefault: true }, select: { id: true } })) ??
    (await tx.status.findFirst({ where: { workspaceId: t.workspaceId, category: "todo" }, orderBy: { sortOrder: "asc" }, select: { id: true } }));
  if (!defaultStatus) return;
  const next = await tx.task.create({
    data: {
      workspaceId: t.workspaceId,
      projectId: t.projectId,
      parentTaskId: t.parentTaskId,
      statusId: defaultStatus.id,
      categoryId: t.categoryId,
      keyResultId: t.keyResultId,
      objectiveId: t.objectiveId,
      title: t.title,
      description: t.description,
      content: t.content,
      priority: t.priority,
      importance: t.importance,
      urgency: t.urgency,
      estimateMinutes: t.estimateMinutes,
      okrWeight: t.okrWeight,
      startDate: start,
      dueDate: due,
      sortOrder: t.sortOrder + 0.5,
      recurrenceFreq: t.recurrenceFreq,
      recurrenceInterval: t.recurrenceInterval,
      recurrenceParentId: t.id,
      createdById: actorId,
      updatedById: actorId,
    },
    select: { id: true },
  });
  if (t.assignees.length) await tx.taskAssignee.createMany({ data: t.assignees.map((a) => ({ taskId: next.id, userId: a.userId, assignedById: actorId })) });
  if (t.reportTo.length) await tx.taskReportRecipient.createMany({ data: t.reportTo.map((r) => ({ taskId: next.id, userId: r.userId, assignedById: actorId })) });
}

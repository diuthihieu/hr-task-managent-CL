import "server-only";
import { prisma } from "../prisma";
import { visibleProjectWhere, type SessionUser } from "../authz";
import { stripMentions } from "../mentions";

// What the sender and the receiver actually did together (last 90 days),
// from existing data: the basis for kudos suggestions and the AI draft.

export interface KudosFact {
  kind: "did_for_you" | "together" | "commented" | "approved" | "on_time" | "speed" | "reported";
  n: number;
  /** Percent (on_time) or days (speed). */
  value?: number;
  tasks: { id: string; title: string }[];
}

export async function kudosContext(sender: SessionUser, workspaceId: string, receiverId: string) {
  const since = new Date(Date.now() - 90 * 86400000);
  const visible = { workspaceId, deletedAt: null, project: { deletedAt: null, ...visibleProjectWhere(sender) } };
  const mine = { OR: [{ createdById: sender.id }, { reportTo: { some: { userId: sender.id } } }, { assignees: { some: { userId: sender.id } } }] };
  const [done, comments, approvals, reported] = await Promise.all([
    prisma.task.findMany({
      where: { ...visible, completedAt: { gte: since }, status: { category: "done" }, assignees: { some: { userId: receiverId } } },
      select: { id: true, title: true, createdAt: true, completedAt: true, dueDate: true, createdById: true, assignees: { select: { userId: true } }, reportTo: { select: { userId: true } } },
      orderBy: { completedAt: "desc" },
      take: 200,
    }),
    prisma.comment.findMany({ where: { authorId: receiverId, deletedAt: null, createdAt: { gte: since }, task: { ...visible, ...mine } }, select: { body: true, task: { select: { id: true, title: true } } }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.taskApproval.findMany({ where: { workspaceId, approverId: receiverId, requestedById: sender.id, status: "approved", decidedAt: { gte: since } }, select: { task: { select: { id: true, title: true } } }, take: 20 }),
    // Keeping the sender informed: tasks the receiver did that report to the sender.
    prisma.task.count({ where: { ...visible, assignees: { some: { userId: receiverId } }, reportTo: { some: { userId: sender.id } }, updatedAt: { gte: since } } }),
  ]);
  const forYou = done.filter((t) => !t.assignees.some((a) => a.userId === sender.id) && (t.createdById === sender.id || t.reportTo.some((r) => r.userId === sender.id)));
  const together = done.filter((t) => t.assignees.some((a) => a.userId === sender.id));
  const withDue = done.filter((t) => t.dueDate);
  const onTime = withDue.filter((t) => t.completedAt!.getTime() < t.dueDate!.getTime() + 86400000);
  const days = done.map((t) => (t.completedAt!.getTime() - t.createdAt.getTime()) / 86400000);
  const uniq = (xs: { id: string; title: string }[]) => [...new Map(xs.map((x) => [x.id, x])).values()].slice(0, 5);
  const facts: KudosFact[] = [];
  if (forYou.length) facts.push({ kind: "did_for_you", n: forYou.length, tasks: uniq(forYou) });
  if (together.length) facts.push({ kind: "together", n: together.length, tasks: uniq(together) });
  if (comments.length) facts.push({ kind: "commented", n: comments.length, tasks: uniq(comments.map((c) => c.task)) });
  if (approvals.length) facts.push({ kind: "approved", n: approvals.length, tasks: uniq(approvals.map((a) => a.task)) });
  if (withDue.length >= 3) facts.push({ kind: "on_time", n: withDue.length, value: Math.round((onTime.length / withDue.length) * 100), tasks: uniq(onTime) });
  if (days.length >= 3) facts.push({ kind: "speed", n: days.length, value: Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10, tasks: [] });
  if (reported) facts.push({ kind: "reported", n: reported, tasks: [] });
  const text = [
    `Tasks they finished that I created or asked to be reported to me: ${forYou.map((t) => t.title).join("; ") || "none"}`,
    `Tasks we finished together: ${together.map((t) => t.title).join("; ") || "none"}`,
    `Their comments on my tasks: ${comments.map((c) => `[${c.task.title}] ${stripMentions(c.body).slice(0, 160)}`).join(" | ") || "none"}`,
    `Approvals they gave me: ${approvals.map((a) => a.task.title).join("; ") || "none"}`,
    withDue.length ? `On-time delivery: ${onTime.length}/${withDue.length} tasks` : "",
    days.length ? `Average time from creation to done: ${Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10} days over ${days.length} tasks` : "",
    reported ? `Tasks they kept me updated on (report to me): ${reported}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { facts, text };
}

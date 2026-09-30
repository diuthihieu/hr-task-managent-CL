// In-app notifications. Event notifications (assigned, status/details
// changed for "Report to" people, new comment) are written in the same
// transaction as the change. Reminders (task due soon / overdue, quick
// captures past their planned time) are generated when the user loads their
// notifications, with a dedupe key so each reminder is created once.

import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

type Tx = Prisma.TransactionClient;

export type NotificationType =
  | "task_assigned"
  | "task_report_added"
  | "task_status"
  | "task_updated"
  | "task_comment"
  | "mention"
  | "task_due_changed"
  | "objective_risk"
  | "approval_request"
  | "approval_result"
  | "ai_suggestion"
  | "workspace_invite"
  | "workspace_invite_result"
  | "role_changed"
  | "role_change_result"
  | "task_due_soon"
  | "task_overdue"
  | "capture_due"
  | "reminder"
  | "kudos"
  | "reward_request"
  | "reward_result";

interface TaskRef {
  id: string;
  title: string;
  projectId: string;
  workspaceId: string;
}

async function taskLink(tx: Tx | typeof prisma, task: TaskRef) {
  const ws = await tx.workspace.findUnique({ where: { id: task.workspaceId }, select: { slug: true } });
  return ws ? `/w/${ws.slug}/p/${task.projectId}/t/${task.id}` : null;
}

/** Users who can see the project (hidden members are skipped). */
async function visibleRecipients(tx: Tx | typeof prisma, projectId: string, userIds: string[]) {
  if (!userIds.length) return [];
  const hidden = await tx.projectHiddenMember.findMany({ where: { projectId, userId: { in: userIds } }, select: { userId: true } });
  const hiddenIds = new Set(hidden.map((h) => h.userId));
  return [...new Set(userIds)].filter((u) => !hiddenIds.has(u));
}

async function createMany(tx: Tx | typeof prisma, userIds: string[], base: Omit<Prisma.NotificationUncheckedCreateInput, "userId">) {
  if (!userIds.length) return;
  await tx.notification.createMany({ data: userIds.map((userId) => ({ ...base, userId })), skipDuplicates: true });
}

/**
 * After a task edit: newly assigned people and newly added report recipients
 * are told; "Report to" people are told about status/detail changes.
 */
export async function notifyTaskPatched(
  tx: Tx,
  opts: { taskId: string; actorId: string | null; changedKeys: string[]; statusChanged: boolean; newStatusName?: string; assigned: string[]; reportAdded: string[]; newDueDate?: string | null }
) {
  const task = await tx.task.findUnique({
    where: { id: opts.taskId },
    select: { id: true, title: true, projectId: true, workspaceId: true, reportTo: { select: { userId: true } }, assignees: { select: { userId: true } } },
  });
  if (!task) return;
  const link = await taskLink(tx, task);
  const notMe = (ids: string[]) => ids.filter((u) => u !== opts.actorId);
  const base = { workspaceId: task.workspaceId, projectId: task.projectId, taskId: task.id, actorId: opts.actorId, title: task.title, link };

  const assigned = await visibleRecipients(tx, task.projectId, notMe(opts.assigned));
  await createMany(tx, assigned, { ...base, type: "task_assigned" });

  const reportAdded = await visibleRecipients(tx, task.projectId, notMe(opts.reportAdded));
  await createMany(tx, reportAdded, { ...base, type: "task_report_added" });

  // A moved deadline matters to the people doing the work.
  if (opts.newDueDate !== undefined) {
    const doers = await visibleRecipients(tx, task.projectId, notMe(task.assignees.map((a) => a.userId)).filter((u) => !opts.assigned.includes(u)));
    await createMany(tx, doers, { ...base, type: "task_due_changed", data: { date: opts.newDueDate ?? "-" } });
  }

  // Status/detail changes go to the report recipients (except the ones just added).
  const meaningful = opts.changedKeys.filter((k) => k !== "reportTo");
  if (!meaningful.length) return;
  const watchers = await visibleRecipients(
    tx,
    task.projectId,
    notMe(task.reportTo.map((r) => r.userId)).filter((u) => !opts.reportAdded.includes(u))
  );
  if (opts.statusChanged) {
    await createMany(tx, watchers, { ...base, type: "task_status", data: { status: opts.newStatusName ?? "" } });
  } else {
    await createMany(tx, watchers, { ...base, type: "task_updated", data: { fields: meaningful } });
  }
}

/** A change made outside the grid PATCH (page content, attachments) — tell report recipients. */
export async function notifyTaskDetail(tx: Tx, taskId: string, actorId: string, field: "content" | "attachments") {
  await notifyTaskPatched(tx, { taskId, actorId, changedKeys: [field], statusChanged: false, assigned: [], reportAdded: [] });
}

/** A newly created task: tell its assignees and report recipients. */
export async function notifyTaskCreated(tx: Tx, taskId: string, actorId: string | null) {
  const task = await tx.task.findUnique({ where: { id: taskId }, select: { assignees: { select: { userId: true } }, reportTo: { select: { userId: true } } } });
  if (!task) return;
  await notifyTaskPatched(tx, {
    taskId,
    actorId,
    changedKeys: [],
    statusChanged: false,
    assigned: task.assignees.map((a) => a.userId),
    reportAdded: task.reportTo.map((r) => r.userId),
  });
}

/** New comment: assignees, report recipients and the task creator (not the author). */
export async function notifyTaskComment(tx: Tx, opts: { taskId: string; actorId: string; excerpt: string; mentioned?: string[] }) {
  const task = await tx.task.findUnique({
    where: { id: opts.taskId },
    select: { id: true, title: true, projectId: true, workspaceId: true, createdById: true, assignees: { select: { userId: true } }, reportTo: { select: { userId: true } } },
  });
  if (!task) return;
  const link = await taskLink(tx, task);
  // Tagged people get a "mentioned you" notification instead of the generic one.
  const mentioned = (opts.mentioned ?? []).filter((u) => u !== opts.actorId);
  await createMany(tx, await visibleRecipients(tx, task.projectId, mentioned), {
    workspaceId: task.workspaceId,
    projectId: task.projectId,
    taskId: task.id,
    actorId: opts.actorId,
    type: "mention",
    title: task.title,
    body: opts.excerpt.slice(0, 280),
    link,
  });
  const ids = [...task.assignees.map((a) => a.userId), ...task.reportTo.map((r) => r.userId), ...(task.createdById ? [task.createdById] : [])].filter((u) => u !== opts.actorId && !mentioned.includes(u));
  const recipients = await visibleRecipients(tx, task.projectId, ids);
  await createMany(tx, recipients, {
    workspaceId: task.workspaceId,
    projectId: task.projectId,
    taskId: task.id,
    actorId: opts.actorId,
    type: "task_comment",
    title: task.title,
    body: opts.excerpt.slice(0, 280),
    link,
  });
}

const DAY = 86_400_000;

function dateKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

/**
 * Reminders for one user, created on demand (idempotent):
 * - assigned tasks due today or tomorrow -> task_due_soon
 * - assigned or reported-to tasks past their due date -> task_overdue
 * - quick captures whose planned time has passed and are still not turned into a task -> capture_due
 */
export async function generateReminders(userId: string, now = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const tomorrow = new Date(today.getTime() + DAY);
  const open = { deletedAt: null, status: { category: { in: ["todo", "in_progress"] as ("todo" | "in_progress")[] } }, project: { deletedAt: null, workspace: { deletedAt: null }, hiddenMembers: { none: { userId } } } };

  const [dueSoon, overdue, thoughts, risky, bigTasks] = await Promise.all([
    prisma.task.findMany({
      where: { ...open, dueDate: { gte: today, lte: tomorrow }, assignees: { some: { userId } } },
      select: { id: true, title: true, projectId: true, workspaceId: true, dueDate: true, workspace: { select: { slug: true } } },
      take: 100,
    }),
    prisma.task.findMany({
      where: { ...open, dueDate: { lt: today }, OR: [{ assignees: { some: { userId } } }, { reportTo: { some: { userId } } }] },
      select: { id: true, title: true, projectId: true, workspaceId: true, dueDate: true, workspace: { select: { slug: true } } },
      take: 100,
    }),
    prisma.capturedThought.findMany({
      where: { userId, status: "captured", plannedAt: { lte: now }, workspace: { deletedAt: null } },
      select: { id: true, taskName: true, plannedAt: true, workspaceId: true, projectId: true, workspace: { select: { slug: true } } },
      take: 100,
    }),
    // Objectives the user owns (or owns a key result of) that are at risk / off track.
    prisma.objective.findMany({
      where: {
        deletedAt: null,
        status: { in: ["at_risk", "off_track"] },
        workspace: { deletedAt: null },
        OR: [{ projectId: null }, { project: { deletedAt: null, hiddenMembers: { none: { userId } } } }],
        AND: [{ OR: [{ ownerId: userId }, { keyResults: { some: { deletedAt: null, ownerId: userId } } }] }],
      },
      select: { id: true, title: true, status: true, workspaceId: true, projectId: true, workspace: { select: { slug: true } }, _count: { select: { tasks: { where: { deletedAt: null } } } }, keyResults: { where: { deletedAt: null }, select: { _count: { select: { tasks: { where: { deletedAt: null } } } } } } },
      take: 50,
    }),
    // Big tasks of mine (>= 8h) not started and not broken down yet.
    prisma.task.findMany({
      where: { deletedAt: null, status: { category: "todo" }, project: open.project, assignees: { some: { userId } }, estimateMinutes: { gte: 480 }, subtasks: { none: { deletedAt: null } } },
      select: { id: true, title: true, projectId: true, workspaceId: true, workspace: { select: { slug: true } } },
      take: 20,
    }),
  ]);

  // AI suggestions: rule-triggered nudges whose action opens the matching AI tool
  // (the AI itself only runs when the user clicks - no model call here).
  const todayKey = dateKey(today);
  const pressing = new Map<string, { slug: string; n: number }>();
  for (const t of [...overdue, ...dueSoon.filter((x) => x.dueDate! <= today)]) {
    const cur = pressing.get(t.workspaceId) ?? { slug: t.workspace.slug, n: 0 };
    cur.n++;
    pressing.set(t.workspaceId, cur);
  }
  const suggestions: Prisma.NotificationCreateManyInput[] = [
    ...[...pressing.entries()]
      .filter(([, v]) => v.n >= 3)
      .map(([workspaceId, v]) => ({ userId, workspaceId, type: "ai_suggestion", title: "Plan my day", data: { kind: "plan_day", count: v.n }, link: `/w/${v.slug}?ai=home_plan`, dedupeKey: `aisug:plan:${workspaceId}:${todayKey}` })),
    ...risky
      .filter((o) => o._count.tasks + o.keyResults.reduce((sum, k) => sum + k._count.tasks, 0) === 0)
      .map((o) => ({ userId, workspaceId: o.workspaceId, projectId: o.projectId, type: "ai_suggestion", title: o.title, data: { kind: "okr_unlinked" }, link: `/w/${o.workspace.slug}/okrs/${o.id}?ai=okr_unlinked`, dedupeKey: `aisug:okr:${o.id}` })),
    ...bigTasks.map((t) => ({ userId, workspaceId: t.workspaceId, projectId: t.projectId, taskId: t.id, type: "ai_suggestion", title: t.title, data: { kind: "task_breakdown" }, link: `/w/${t.workspace.slug}/p/${t.projectId}/t/${t.id}?ai=task_breakdown`, dedupeKey: `aisug:breakdown:${t.id}` })),
  ];

  const rows: Prisma.NotificationCreateManyInput[] = [
    ...dueSoon.map((t) => ({
      userId,
      workspaceId: t.workspaceId,
      projectId: t.projectId,
      taskId: t.id,
      type: "task_due_soon",
      title: t.title,
      data: { dueDate: dateKey(t.dueDate!) },
      link: `/w/${t.workspace.slug}/p/${t.projectId}/t/${t.id}`,
      dedupeKey: `due_soon:${t.id}:${dateKey(t.dueDate!)}`,
    })),
    ...overdue.map((t) => ({
      userId,
      workspaceId: t.workspaceId,
      projectId: t.projectId,
      taskId: t.id,
      type: "task_overdue",
      title: t.title,
      data: { dueDate: dateKey(t.dueDate!) },
      link: `/w/${t.workspace.slug}/p/${t.projectId}/t/${t.id}`,
      dedupeKey: `overdue:${t.id}:${dateKey(t.dueDate!)}`,
    })),
    ...thoughts.map((th) => ({
      userId,
      workspaceId: th.workspaceId,
      projectId: th.projectId,
      thoughtId: th.id,
      type: "capture_due",
      title: th.taskName,
      data: { plannedAt: th.plannedAt!.toISOString() },
      link: `/w/${th.workspace.slug}/my-work`,
      dedupeKey: `capture:${th.id}:${th.plannedAt!.toISOString()}`,
    })),
    ...risky.map((o) => ({
      userId,
      workspaceId: o.workspaceId,
      projectId: o.projectId,
      type: "objective_risk",
      title: o.title,
      data: { status: o.status },
      link: `/w/${o.workspace.slug}/okrs/${o.id}`,
      dedupeKey: `objrisk:${o.id}:${o.status}`,
    })),
    ...suggestions,
  ];
  if (rows.length) await prisma.notification.createMany({ data: rows, skipDuplicates: true });
}

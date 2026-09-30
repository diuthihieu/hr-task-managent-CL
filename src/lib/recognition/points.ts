import "server-only";
import type { PointAction, Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { forbidden, roleAtLeast, type SessionUser } from "../authz";
import { DEFAULT_POINTS, POINT_ACTIONS, type PointActionName } from "./core";
import { supportAccess } from "@/lib/authz";

// Points: every rewarded action is materialized into the point_events ledger
// from the activity that already exists (tasks, comments, kudos, wiki pages,
// decisions, focus sessions, approvals). Syncing is incremental and
// idempotent (unique per user + action + source), so it can run on every
// read; changing a rule applies from then on (or after "Recalculate").

type Db = Prisma.TransactionClient | typeof prisma;
const DAY = 86400000;

export async function recognitionSettings(workspaceId: string) {
  return (await prisma.recognitionSettings.findUnique({ where: { workspaceId } })) ?? prisma.recognitionSettings.upsert({ where: { workspaceId }, create: { workspaceId }, update: {} });
}

export async function pointRules(workspaceId: string): Promise<Record<PointActionName, { points: number; enabled: boolean }>> {
  const rows = await prisma.pointRule.findMany({ where: { workspaceId } });
  const out = {} as Record<PointActionName, { points: number; enabled: boolean }>;
  for (const a of POINT_ACTIONS) {
    const r = rows.find((x) => x.action === a);
    out[a] = { points: r?.points ?? DEFAULT_POINTS[a], enabled: r?.enabled ?? true };
  }
  return out;
}

/** Workspace admins/owners, plus the people they delegated recognition to. */
export async function canManageRecognition(user: SessionUser, workspaceId: string, role: string): Promise<boolean> {
  if (supportAccess(user) || roleAtLeast(role as never, "admin")) return true;
  return !!(await prisma.recognitionManager.findUnique({ where: { workspaceId_userId: { workspaceId, userId: user.id } } }));
}
export async function requireRecognitionManager(user: SessionUser, workspaceId: string, role: string) {
  if (!(await canManageRecognition(user, workspaceId, role))) throw forbidden("Only workspace admins or recognition managers can do this");
}

/** May `user` see other members' points? Managers always; others per member override, else the workspace default. */
export async function canSeeOthersPoints(user: SessionUser, workspaceId: string, role: string): Promise<boolean> {
  if (await canManageRecognition(user, workspaceId, role)) return true;
  const [s, m] = await Promise.all([recognitionSettings(workspaceId), prisma.recognitionMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: user.id } } })]);
  return m ? m.canViewOthersPoints : s.membersSeePoints;
}

interface Ev {
  userId: string;
  action: PointAction;
  sourceId: string;
  occurredAt: Date;
  points?: number;
}

/** Materializes points for activity since the last sync (with a 2-day overlap; duplicates are skipped). */
export async function syncPoints(workspaceId: string, opts: { full?: boolean } = {}) {
  const settings = await recognitionSettings(workspaceId);
  if (!settings.enabled) return { added: 0 };
  const rules = await pointRules(workspaceId);
  const floor = settings.pointsSince ?? new Date(0);
  const since = opts.full || !settings.lastSyncedAt ? floor : new Date(Math.max(floor.getTime(), settings.lastSyncedAt.getTime() - 2 * DAY));
  const startedAt = new Date();
  const on = (a: PointActionName) => rules[a].enabled && rules[a].points !== 0;
  const members = new Set((await prisma.workspaceMember.findMany({ where: { workspaceId }, select: { userId: true } })).map((m) => m.userId));
  const ev: Ev[] = [];
  const liveTask = { workspaceId, deletedAt: null, project: { deletedAt: null } };

  const [done, created, comments, kudos, pages, decisions, focus, approvals] = await Promise.all([
    on("task_completed") || on("task_on_time")
      ? prisma.task.findMany({ where: { ...liveTask, completedAt: { gte: since }, status: { category: "done" } }, select: { id: true, completedAt: true, dueDate: true, assignees: { select: { userId: true } } } })
      : [],
    on("task_created") ? prisma.task.findMany({ where: { ...liveTask, createdAt: { gte: since }, createdById: { not: null } }, select: { id: true, createdAt: true, createdById: true } }) : [],
    on("comment_posted") || on("helped_colleague")
      ? prisma.comment.findMany({
          where: { deletedAt: null, createdAt: { gte: since }, authorId: { not: null }, task: liveTask },
          select: { id: true, createdAt: true, authorId: true, task: { select: { createdById: true, assignees: { select: { userId: true } } } } },
        })
      : [],
    on("kudos_received") || on("kudos_sent") ? prisma.kudos.findMany({ where: { workspaceId, deletedAt: null, createdAt: { gte: since } }, select: { id: true, fromId: true, toId: true, createdAt: true } }) : [],
    on("wiki_page_created") ? prisma.wikiPage.findMany({ where: { workspaceId, deletedAt: null, createdAt: { gte: since }, createdById: { not: null }, sourceType: { not: "ai_generated" } }, select: { id: true, createdAt: true, createdById: true } }) : [],
    on("decision_recorded") ? prisma.decision.findMany({ where: { workspaceId, deletedAt: null, createdAt: { gte: since }, createdById: { not: null } }, select: { id: true, createdAt: true, createdById: true } }) : [],
    on("focus_hour") ? prisma.focusSession.findMany({ where: { workspaceId, status: "completed", endedAt: { gte: since } }, select: { id: true, userId: true, endedAt: true, elapsedSeconds: true } }) : [],
    on("approval_given") ? prisma.taskApproval.findMany({ where: { workspaceId, status: { in: ["approved", "rejected"] }, decidedAt: { gte: since } }, select: { id: true, approverId: true, requestedById: true, decidedAt: true } }) : [],
  ]);

  for (const t of done) {
    const onTime = t.dueDate && t.completedAt!.getTime() < t.dueDate.getTime() + DAY;
    for (const a of t.assignees) {
      if (on("task_completed")) ev.push({ userId: a.userId, action: "task_completed", sourceId: t.id, occurredAt: t.completedAt! });
      if (on("task_on_time") && onTime) ev.push({ userId: a.userId, action: "task_on_time", sourceId: t.id, occurredAt: t.completedAt! });
    }
  }
  for (const t of created) ev.push({ userId: t.createdById!, action: "task_created", sourceId: t.id, occurredAt: t.createdAt });
  for (const c of comments) {
    if (on("comment_posted")) ev.push({ userId: c.authorId!, action: "comment_posted", sourceId: c.id, occurredAt: c.createdAt });
    // Helping: commenting on someone else's task (not yours, not assigned to you).
    const mine = c.task.createdById === c.authorId || c.task.assignees.some((a) => a.userId === c.authorId);
    if (on("helped_colleague") && !mine) ev.push({ userId: c.authorId!, action: "helped_colleague", sourceId: c.id, occurredAt: c.createdAt });
  }
  for (const k of kudos) {
    // At most one rewarded kudos per sender -> receiver per day (no farming).
    const dayKey = k.createdAt.toISOString().slice(0, 10);
    if (on("kudos_received")) ev.push({ userId: k.toId, action: "kudos_received", sourceId: `${k.fromId}:${dayKey}`, occurredAt: k.createdAt });
    if (on("kudos_sent")) ev.push({ userId: k.fromId, action: "kudos_sent", sourceId: `${k.toId}:${dayKey}`, occurredAt: k.createdAt });
  }
  for (const p of pages) ev.push({ userId: p.createdById!, action: "wiki_page_created", sourceId: p.id, occurredAt: p.createdAt });
  for (const d of decisions) ev.push({ userId: d.createdById!, action: "decision_recorded", sourceId: d.id, occurredAt: d.createdAt });
  for (const f of focus) {
    const hours = Math.floor(f.elapsedSeconds / 3600);
    if (hours > 0) ev.push({ userId: f.userId, action: "focus_hour", sourceId: f.id, occurredAt: f.endedAt!, points: hours * rules.focus_hour.points });
  }
  for (const a of approvals) if (a.approverId !== a.requestedById) ev.push({ userId: a.approverId, action: "approval_given", sourceId: a.id, occurredAt: a.decidedAt! });

  const rows = ev
    .filter((e) => members.has(e.userId) && e.occurredAt >= floor)
    .map((e) => ({ workspaceId, userId: e.userId, action: e.action, sourceId: e.sourceId, occurredAt: e.occurredAt, points: e.points ?? rules[e.action as PointActionName].points }));
  let added = 0;
  for (let i = 0; i < rows.length; i += 1000) added += (await prisma.pointEvent.createMany({ data: rows.slice(i, i + 1000), skipDuplicates: true })).count;
  await prisma.recognitionSettings.update({ where: { workspaceId }, data: { lastSyncedAt: startedAt } });
  if (added) await notifyReachableRewards(workspaceId);
  return { added };
}

/** Sync if the last sync is older than `maxAgeMs` (cheap to call from read paths). */
export async function syncPointsIfStale(workspaceId: string, maxAgeMs = 60_000) {
  const s = await prisma.recognitionSettings.findUnique({ where: { workspaceId }, select: { lastSyncedAt: true, enabled: true } });
  if (s && (!s.enabled || (s.lastSyncedAt && Date.now() - s.lastSyncedAt.getTime() < maxAgeMs))) return;
  await syncPoints(workspaceId);
}

/** Balance = all points earned - points reserved (pending) or spent (approved) on rewards. */
export async function pointBalances(db: Db, workspaceId: string, userIds?: string[]) {
  const [earned, spent] = await Promise.all([
    db.pointEvent.groupBy({ by: ["userId"], where: { workspaceId, ...(userIds ? { userId: { in: userIds } } : {}) }, _sum: { points: true } }),
    db.rewardRedemption.groupBy({ by: ["userId", "status"], where: { workspaceId, status: { in: ["pending", "approved"] }, ...(userIds ? { userId: { in: userIds } } : {}) }, _sum: { points: true } }),
  ]);
  const out = new Map<string, { earned: number; pending: number; spent: number; balance: number }>();
  const get = (u: string) => out.get(u) ?? out.set(u, { earned: 0, pending: 0, spent: 0, balance: 0 }).get(u)!;
  for (const e of earned) get(e.userId).earned = e._sum.points ?? 0;
  for (const s of spent) {
    const b = get(s.userId);
    if (s.status === "pending") b.pending += s._sum.points ?? 0;
    else b.spent += s._sum.points ?? 0;
  }
  for (const b of out.values()) b.balance = b.earned - b.pending - b.spent;
  return out;
}

/**
 * Tells members as soon as their balance covers a reward that is still in
 * stock (once per reward). Rule-based trigger delivered through the AI
 * suggestion channel, so it appears in the inbox and as a pop-up.
 */
export async function notifyReachableRewards(workspaceId: string) {
  const rewards = await prisma.reward.findMany({ where: { workspaceId, active: true, deletedAt: null }, select: { id: true, name: true, pointsCost: true, quantity: true, approvedCount: true }, orderBy: { pointsCost: "asc" } });
  const inStock = rewards.filter((r) => r.approvedCount < r.quantity);
  if (!inStock.length) return;
  const [ws, balances] = await Promise.all([prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { slug: true } }), pointBalances(prisma, workspaceId)]);
  const rows: Prisma.NotificationCreateManyInput[] = [];
  for (const [userId, b] of balances)
    for (const r of inStock)
      if (b.balance >= r.pointsCost)
        rows.push({
          userId,
          workspaceId,
          type: "ai_suggestion",
          title: r.name,
          body: null,
          data: { kind: "reward_reachable", reward: r.name, points: b.balance, cost: r.pointsCost },
          link: `/w/${ws.slug}/recognition?tab=rewards`,
          dedupeKey: `reward-reachable:${r.id}`,
        });
  if (rows.length) await prisma.notification.createMany({ data: rows, skipDuplicates: true });
}

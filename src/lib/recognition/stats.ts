import "server-only";
import { prisma } from "../prisma";
import { visibleProjectWhere, type SessionUser } from "../authz";
import type { LeaderboardMetric } from "./core";

export interface Person {
  id: string;
  name: string;
  avatarColor: string | null;
  hasAvatar?: boolean;
}
export interface BoardRow {
  rank: number;
  user: Person;
  value: number;
  /** Supporters: what they did for you. */
  detail?: Record<string, number>;
}

function rank(values: Map<string, number>, people: Map<string, Person>, top: number, meId: string) {
  const all = [...values.entries()].filter(([id, v]) => v > 0 && people.has(id)).sort((a, b) => b[1] - a[1]);
  const rows: BoardRow[] = [];
  let prev = Number.NaN;
  let r = 0;
  all.forEach(([id, v], i) => {
    if (v !== prev) r = i + 1;
    prev = v;
    rows.push({ rank: r, user: people.get(id)!, value: Math.round(v * 10) / 10 });
  });
  return { rows: rows.slice(0, top), me: rows.find((x) => x.user.id === meId) ?? null, total: rows.length };
}

async function members(workspaceId: string) {
  const ms = await prisma.workspaceMember.findMany({ where: { workspaceId, user: { isActive: true, deletedAt: null } }, select: { user: { select: { id: true, name: true, avatarColor: true, avatarUpdatedAt: true } } } });
  return new Map(ms.map((m) => [m.user.id, { id: m.user.id, name: m.user.name, avatarColor: m.user.avatarColor, hasAvatar: !!m.user.avatarUpdatedAt }]));
}

/** Top members for a metric in [from, to). Task-based metrics only count tasks the viewer can see. */
export async function leaderboard(viewer: SessionUser, workspaceId: string, metric: LeaderboardMetric, from: Date, to: Date, top: number) {
  const people = await members(workspaceId);
  const values = new Map<string, number>();
  const add = (id: string, v: number) => values.set(id, (values.get(id) ?? 0) + v);
  if (metric === "points") {
    for (const g of await prisma.pointEvent.groupBy({ by: ["userId"], where: { workspaceId, occurredAt: { gte: from, lt: to } }, _sum: { points: true } })) add(g.userId, g._sum.points ?? 0);
  } else if (metric === "kudos") {
    for (const g of await prisma.kudos.groupBy({ by: ["toId"], where: { workspaceId, deletedAt: null, createdAt: { gte: from, lt: to } }, _count: { _all: true } })) add(g.toId, g._count._all);
  } else {
    const tasks = await prisma.task.findMany({
      where: { workspaceId, deletedAt: null, project: { deletedAt: null, ...visibleProjectWhere(viewer) }, completedAt: { gte: from, lt: to }, status: { category: "done" } },
      select: { actualMinutes: true, estimateMinutes: true, assignees: { select: { userId: true } } },
      take: 20000,
    });
    for (const t of tasks) for (const a of t.assignees) add(a.userId, metric === "tasks" ? 1 : (t.actualMinutes ?? t.estimateMinutes ?? 0) / 60);
  }
  return rank(values, people, top, viewer.id);
}

const W = { comments: 1, completedForYou: 2, approvals: 2, kudos: 3, coWork: 1 };

/**
 * The colleagues who helped `me` most in [from, to): comments on my tasks,
 * tasks they finished that I created or asked to be reported to me,
 * approvals they gave me, kudos they sent me, tasks we completed together.
 */
export async function supporters(viewer: SessionUser, workspaceId: string, from: Date, to: Date, top: number) {
  const me = viewer.id;
  const people = await members(workspaceId);
  const visible = { deletedAt: null, project: { deletedAt: null, ...visibleProjectWhere(viewer) } };
  const mine = { OR: [{ createdById: me }, { assignees: { some: { userId: me } } }, { reportTo: { some: { userId: me } } }] };
  const range = { gte: from, lt: to };
  const [comments, done, approvals, kudos] = await Promise.all([
    prisma.comment.findMany({ where: { deletedAt: null, createdAt: range, authorId: { not: me }, task: { workspaceId, ...visible, ...mine } }, select: { authorId: true } }),
    prisma.task.findMany({ where: { workspaceId, ...visible, completedAt: range, status: { category: "done" }, ...mine }, select: { createdById: true, assignees: { select: { userId: true } }, reportTo: { select: { userId: true } } } }),
    prisma.taskApproval.findMany({ where: { workspaceId, requestedById: me, approverId: { not: me }, status: { in: ["approved", "rejected"] }, decidedAt: range }, select: { approverId: true } }),
    prisma.kudos.findMany({ where: { workspaceId, deletedAt: null, toId: me, createdAt: range }, select: { fromId: true } }),
  ]);
  const detail = new Map<string, Record<string, number>>();
  const bump = (id: string | null | undefined, k: keyof typeof W) => {
    if (!id || id === me) return;
    const d = detail.get(id) ?? detail.set(id, {}).get(id)!;
    d[k] = (d[k] ?? 0) + 1;
  };
  for (const c of comments) bump(c.authorId, "comments");
  for (const t of done) {
    const assignees = t.assignees.map((a) => a.userId);
    const iAmAssignee = assignees.includes(me);
    for (const a of assignees) {
      if (iAmAssignee) bump(a, "coWork");
      else if (t.createdById === me || t.reportTo.some((r) => r.userId === me)) bump(a, "completedForYou");
    }
  }
  for (const a of approvals) bump(a.approverId, "approvals");
  for (const k of kudos) bump(k.fromId, "kudos");
  const values = new Map([...detail.entries()].map(([id, d]) => [id, Object.entries(d).reduce((s, [k, n]) => s + n * W[k as keyof typeof W], 0)]));
  const r = rank(values, people, top, "");
  return { rows: r.rows.map((row) => ({ ...row, detail: detail.get(row.user.id) })), total: r.total };
}

// The caller's notification inbox: what the bell and the Action center list and count.
import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hiddenProjectIds, type SessionUser } from "@/lib/authz";
import { generateReminders } from "@/lib/notifications";
import { syncInvitations } from "@/lib/invitations";
import { syncPointsIfStale } from "@/lib/recognition/points";
import { notifyGroupOf, type NotifyGroup } from "@/lib/notification-prefs";
import { REWARD_REACHABLE, deviceOnlyGroups, inGroups, ofTypes } from "./filters";

export interface InboxQuery {
  view: string;
  unreadOnly: boolean;
  /** An Action center chip's types (muted or not); empty = everything not muted. */
  types: string[];
}

/** Keeps points (and "you can redeem a reward" notices) fresh; at most every 10 minutes per workspace. */
async function syncMyWorkspacesPoints(userId: string) {
  const ws = await prisma.workspaceMember.findMany({ where: { userId, workspace: { deletedAt: null } }, select: { workspaceId: true }, take: 20 });
  await Promise.all(ws.map((w) => syncPointsIfStale(w.workspaceId, 10 * 60_000).catch((e) => console.error("[recognition] sync failed", e))));
}

/** Creates what is due before listing: reminders, invitation notices and reward-reachable notices. */
export async function refreshInbox(user: SessionUser) {
  await Promise.all([generateReminders(user.id), syncInvitations(user), syncMyWorkspacesPoints(user.id)]);
}

const INCLUDE = {
  actor: { select: { id: true, name: true, avatarColor: true } },
  workspace: { select: { name: true } },
  project: { select: { name: true } },
  task: { select: { id: true, deletedAt: true, status: { select: { category: true } } } },
} satisfies Prisma.NotificationInclude;
type Row = Prisma.NotificationGetPayload<{ include: typeof INCLUDE }>;

/**
 * The caller's notifications.
 * view=todo (not acted on, not snoozed) | all | snoozed; unreadOnly.
 * `unread` counts unread, un-snoozed items of the groups the user did not switch off for the app
 * (Settings -> Notifications -> In-app); `unreadAll` counts them all.
 * Switched-off groups are filtered out in the query itself, before the 100-item limit, so a busy day of
 * "Updates" the user muted can never push their mentions and comments out of the bell or the Action center.
 * `types` (an Action center group chip) returns just those types, muted or not.
 * `typeCounts` counts every type in this view (not capped at 100), for the Action center chips.
 */
export async function listInbox(user: SessionUser, q: InboxQuery) {
  const now = new Date();
  // Only what the user may still see: workspaces they belong to (invitations excepted,
  // they come before membership) and projects not hidden from them. Access removed
  // later hides older notifications too, instead of leaking titles, names and links.
  const hidden = [...(await hiddenProjectIds(user))];
  const live = {
    AND: [
      { OR: [{ workspaceId: null }, { type: { in: ["workspace_invite", "workspace_invite_result"] }, workspace: { deletedAt: null } }, { workspace: { deletedAt: null, members: { some: { userId: user.id } } } }] },
      ...(hidden.length ? [{ OR: [{ projectId: null }, { projectId: { notIn: hidden } }] }] : []),
    ],
  };
  const notSnoozed = { OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] };
  const viewWhere: Prisma.NotificationWhereInput = {
    userId: user.id,
    AND: [
      live,
      ...(q.view === "snoozed" ? [{ snoozedUntil: { gt: now } }] : [notSnoozed]),
      ...(q.view === "todo" ? [{ actionedAt: null }] : []),
      ...(q.unreadOnly ? [{ readAt: null }] : []),
    ],
  };
  const me = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { notifyPopupOff: true, notifyNativeOff: true } });
  const off = new Set(me.notifyPopupOff as NotifyGroup[]);
  // Groups switched off in the app but still allowed on the device: the bell's poll gets their newest unread
  // items separately (`deviceItems`), only to raise system notifications - never listed, never counted.
  const deviceOnly = deviceOnlyGroups([...off], me.notifyNativeOff as NotifyGroup[]);
  const where: Prisma.NotificationWhereInput = q.types.length ? { AND: [viewWhere, ofTypes(q.types)] } : off.size ? { AND: [viewWhere, { NOT: inGroups([...off]) }] } : viewWhere;
  const isMuted = (n: { type: string; data: unknown }) => {
    const g = notifyGroupOf(n);
    return !!g && off.has(g);
  };
  const [items, unreadRows, byType, rewardReachable, deviceRows] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, take: 100, include: INCLUDE }),
    prisma.notification.findMany({ where: { userId: user.id, readAt: null, AND: [live, notSnoozed] }, select: { type: true, data: true }, take: 10_000 }),
    prisma.notification.groupBy({ by: ["type"], where: viewWhere, _count: { _all: true } }),
    prisma.notification.count({ where: { AND: [viewWhere, REWARD_REACHABLE] } }),
    !q.types.length && q.view === "all" && deviceOnly.length
      ? prisma.notification.findMany({ where: { AND: [viewWhere, { readAt: null }, inGroups(deviceOnly)] }, orderBy: { createdAt: "desc" }, take: 20, include: INCLUDE })
      : Promise.resolve([] as Row[]),
  ]);
  const serialize = (n: Row) => ({
    muted: isMuted(n),
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    data: n.data,
    link: n.link,
    read: Boolean(n.readAt),
    actioned: Boolean(n.actionedAt),
    snoozedUntil: n.snoozedUntil && n.snoozedUntil > now ? n.snoozedUntil.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
    actor: n.actor,
    workspaceId: n.workspaceId,
    workspaceName: n.workspace?.name ?? null,
    projectName: n.project?.name ?? null,
    taskId: n.task && !n.task.deletedAt ? n.task.id : null,
    taskOpen: n.task ? !n.task.deletedAt && (n.task.status.category === "todo" || n.task.status.category === "in_progress") : false,
  });
  return {
    unread: unreadRows.filter((n) => !isMuted(n)).length,
    unreadAll: unreadRows.length,
    typeCounts: Object.fromEntries(byType.map((r) => [r.type, r._count._all])),
    /** Of the ai_suggestion count, the "you can redeem a reward" notices (they belong to recognition). */
    rewardReachable,
    mutedGroups: [...off],
    deviceItems: deviceRows.map(serialize),
    items: items.map(serialize),
  };
}

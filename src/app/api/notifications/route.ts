import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hiddenProjectIds, requireUser, route } from "@/lib/authz";
import { generateReminders } from "@/lib/notifications";
import { syncInvitations } from "@/lib/invitations";
import { syncPointsIfStale } from "@/lib/recognition/points";
import { NOTIFY_GROUPS, notifyGroupOf, type NotifyGroup } from "@/lib/notification-prefs";

/** Keeps points (and "you can redeem a reward" notices) fresh; at most every 10 minutes per workspace. */
async function syncMyWorkspacesPoints(userId: string) {
  const ws = await prisma.workspaceMember.findMany({ where: { userId, workspace: { deletedAt: null } }, select: { workspaceId: true }, take: 20 });
  await Promise.all(ws.map((w) => syncPointsIfStale(w.workspaceId, 10 * 60_000).catch((e) => console.error("[recognition] sync failed", e))));
}

const REWARD_REACHABLE: Prisma.NotificationWhereInput = { type: "ai_suggestion", data: { path: ["kind"], equals: "reward_reachable" } };

/** Notifications that belong to any of these groups ("you can redeem a reward" AI notices count as recognition). */
function inGroups(groups: NotifyGroup[]): Prisma.NotificationWhereInput {
  const types = NOTIFY_GROUPS.filter((g) => groups.includes(g.key)).flatMap((g) => g.types as readonly string[]).filter((t) => t !== "ai_suggestion");
  return {
    OR: [
      { type: { in: types } },
      ...(groups.includes("ai") ? [{ type: "ai_suggestion", OR: [{ data: { equals: Prisma.AnyNull } }, { NOT: REWARD_REACHABLE }] }] : []),
      ...(groups.includes("recognition") ? [REWARD_REACHABLE] : []),
    ],
  };
}

/**
 * The caller's notifications (reminders are generated on the fly).
 * ?view=todo (default: not acted on, not snoozed) | all | snoozed; ?unread=1.
 * `unread` counts unread, un-snoozed items of the groups the user did not switch off for the app
 * (Settings -> Notifications -> In-app); `unreadAll` counts them all.
 * Switched-off groups are filtered out in the query itself, before the 100-item limit, so a busy day of
 * "Updates" the user muted can never push their mentions and comments out of the bell or the Action center.
 * ?types=a,b (an Action center group chip) returns just those types, muted or not.
 * `typeCounts` counts every type in this view (not capped at 100), for the Action center chips.
 */
export const GET = route(async (req) => {
  const user = await requireUser();
  await Promise.all([generateReminders(user.id), syncInvitations(user), syncMyWorkspacesPoints(user.id)]);
  const url = new URL(req.url);
  const now = new Date();
  const view = url.searchParams.get("view") ?? "all";
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
      ...(view === "snoozed" ? [{ snoozedUntil: { gt: now } }] : [notSnoozed]),
      ...(view === "todo" ? [{ actionedAt: null }] : []),
      ...(url.searchParams.get("unread") === "1" ? [{ readAt: null }] : []),
    ],
  };
  const me = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { notifyPopupOff: true, notifyNativeOff: true } });
  const off = new Set(me.notifyPopupOff as NotifyGroup[]);
  // Groups switched off in the app but still allowed on the device: the bell's poll gets their newest unread
  // items separately (`deviceItems`), only to raise system notifications - never listed, never counted.
  const deviceOnly = [...off].filter((g) => !(me.notifyNativeOff as NotifyGroup[]).includes(g));
  const types = (url.searchParams.get("types") ?? "").split(",").map((t) => t.trim()).filter((t) => /^[a-z_]{1,40}$/.test(t)).slice(0, 20);
  // A chip's types, with "you can redeem a reward" AI notices listed under Recognition rather than AI.
  const typeWhere: Prisma.NotificationWhereInput = {
    OR: [
      { type: { in: types.filter((t) => t !== "ai_suggestion") } },
      ...(types.includes("ai_suggestion") ? [{ type: "ai_suggestion", OR: [{ data: { equals: Prisma.AnyNull } }, { NOT: REWARD_REACHABLE }] }] : []),
      ...(types.includes("kudos") ? [REWARD_REACHABLE] : []),
    ],
  };
  const where: Prisma.NotificationWhereInput = types.length
    ? { AND: [viewWhere, typeWhere] }
    : off.size
      ? { AND: [viewWhere, { NOT: inGroups([...off]) }] }
      : viewWhere;
  const isMuted = (n: { type: string; data: unknown }) => {
    const g = notifyGroupOf(n);
    return !!g && off.has(g);
  };
  const include = {
    actor: { select: { id: true, name: true, avatarColor: true } },
    workspace: { select: { name: true } },
    project: { select: { name: true } },
    task: { select: { id: true, deletedAt: true, status: { select: { category: true } } } },
  } satisfies Prisma.NotificationInclude;
  const [items, unreadRows, byType, rewardReachable, deviceRows] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      include,
    }),
    prisma.notification.findMany({ where: { userId: user.id, readAt: null, AND: [live, notSnoozed] }, select: { type: true, data: true }, take: 10_000 }),
    prisma.notification.groupBy({ by: ["type"], where: viewWhere, _count: { _all: true } }),
    prisma.notification.count({ where: { AND: [viewWhere, REWARD_REACHABLE] } }),
    !types.length && view === "all" && deviceOnly.length
      ? prisma.notification.findMany({ where: { AND: [viewWhere, { readAt: null }, inGroups(deviceOnly)] }, orderBy: { createdAt: "desc" }, take: 20, include })
      : Promise.resolve([]),
  ]);
  type Row = (typeof items)[number];
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
  return NextResponse.json({
    unread: unreadRows.filter((n) => !isMuted(n)).length,
    unreadAll: unreadRows.length,
    typeCounts: Object.fromEntries(byType.map((r) => [r.type, r._count._all])),
    /** Of the ai_suggestion count, the "you can redeem a reward" notices (they belong to recognition). */
    rewardReachable,
    mutedGroups: [...off],
    deviceItems: deviceRows.map(serialize),
    items: items.map(serialize),
  });
});

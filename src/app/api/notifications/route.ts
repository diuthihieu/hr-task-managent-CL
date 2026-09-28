import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, route } from "@/lib/authz";
import { generateReminders } from "@/lib/notifications";

/**
 * The caller's notifications (reminders are generated on the fly).
 * ?view=todo (default: not acted on, not snoozed) | all | snoozed; ?unread=1.
 * `unread` counts unread, un-snoozed items.
 */
export const GET = route(async (req) => {
  const user = await requireUser();
  await generateReminders(user.id);
  const url = new URL(req.url);
  const now = new Date();
  const view = url.searchParams.get("view") ?? "all";
  const live = { OR: [{ workspaceId: null }, { workspace: { deletedAt: null } }] };
  const notSnoozed = { OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] };
  const where = {
    userId: user.id,
    AND: [
      live,
      ...(view === "snoozed" ? [{ snoozedUntil: { gt: now } }] : [notSnoozed]),
      ...(view === "todo" ? [{ actionedAt: null }] : []),
      ...(url.searchParams.get("unread") === "1" ? [{ readAt: null }] : []),
    ],
  };
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        actor: { select: { id: true, name: true, avatarColor: true } },
        workspace: { select: { name: true } },
        project: { select: { name: true } },
        task: { select: { id: true, deletedAt: true, status: { select: { category: true } } } },
      },
    }),
    prisma.notification.count({ where: { userId: user.id, readAt: null, AND: [live, notSnoozed] } }),
  ]);
  return NextResponse.json({
    unread,
    items: items.map((n) => ({
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
      workspaceName: n.workspace?.name ?? null,
      projectName: n.project?.name ?? null,
      taskId: n.task && !n.task.deletedAt ? n.task.id : null,
      taskOpen: n.task ? !n.task.deletedAt && (n.task.status.category === "todo" || n.task.status.category === "in_progress") : false,
    })),
  });
});

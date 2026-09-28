import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, route } from "@/lib/authz";
import { generateReminders } from "@/lib/notifications";

/** The caller's latest notifications (reminders are generated on the fly) and the unread count. */
export const GET = route(async (req) => {
  const user = await requireUser();
  await generateReminders(user.id);
  const url = new URL(req.url);
  const unreadOnly = url.searchParams.get("unread") === "1";
  const where = { userId: user.id, ...(unreadOnly ? { readAt: null } : {}), OR: [{ workspaceId: null }, { workspace: { deletedAt: null } }] };
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { actor: { select: { id: true, name: true, avatarColor: true } }, workspace: { select: { name: true } }, project: { select: { name: true } } },
    }),
    prisma.notification.count({ where: { userId: user.id, readAt: null, OR: [{ workspaceId: null }, { workspace: { deletedAt: null } }] } }),
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
      createdAt: n.createdAt.toISOString(),
      actor: n.actor,
      workspaceName: n.workspace?.name ?? null,
      projectName: n.project?.name ?? null,
    })),
  });
});

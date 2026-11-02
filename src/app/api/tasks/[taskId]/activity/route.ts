import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, workspaceOfTask } from "@/lib/authz";
import { serializeActivity } from "@/lib/activity-query";
import { assertCursor, pageArgs, readPage, toPage } from "@/lib/pagination";

type P = { taskId: string };

/** `{ items, nextCursor }`, newest first; `?cursor=` loads older entries (archived ones are not listed). */
export const GET = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { taskId } = await params;
  await requireWorkspaceRole(user, await workspaceOfTask(taskId), "viewer");
  const page = readPage(req);
  const where = { entityType: "task", entityId: taskId };
  if (page.cursor) assertCursor(await prisma.activityLog.findFirst({ where: { ...where, id: page.cursor }, select: { id: true } }));
  const rows = await prisma.activityLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...pageArgs(page),
    include: { actor: { select: { id: true, name: true, avatarColor: true } } },
  });
  const { items, nextCursor } = toPage(rows, page);
  return NextResponse.json({ items: items.map(serializeActivity), nextCursor });
});

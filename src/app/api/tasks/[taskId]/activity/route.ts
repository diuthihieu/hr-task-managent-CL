import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, workspaceOfTask } from "@/lib/authz";
import { serializeActivity } from "@/lib/activity-query";

type P = { taskId: string };

export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { taskId } = await params;
  await requireWorkspaceRole(user, await workspaceOfTask(taskId), "viewer");
  const rows = await prisma.activityLog.findMany({
    where: { entityType: "task", entityId: taskId },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { actor: { select: { id: true, name: true, avatarColor: true } } },
  });
  return NextResponse.json(rows.map(serializeActivity));
});

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, notFound } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { loadTaskRecord } from "@/lib/task-grid";

type P = { taskId: string };

export const POST = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { taskId } = await params;
  const task = await prisma.task.findFirst({ where: { id: taskId, deletedAt: { not: null }, project: { deletedAt: null } }, select: { workspaceId: true, title: true } });
  if (!task) throw notFound("Deleted task");
  const ctx = await requireWorkspaceRole(user, task.workspaceId, "editor");
  const record = await prisma.$transaction(async (tx) => {
    await tx.task.update({ where: { id: taskId }, data: { deletedAt: null, deletedById: null, updatedById: user.id } });
    await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "task", entityId: taskId, action: "restored", summary: `Restored task "${task.title}"` });
    return loadTaskRecord(taskId, tx);
  });
  return NextResponse.json(record);
});

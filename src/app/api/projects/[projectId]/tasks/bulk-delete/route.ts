import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfProject } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { uuid } from "@/lib/validation";

type P = { projectId: string };

export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { projectId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfProject(projectId), "editor");
  const { ids } = z.object({ ids: z.array(uuid).min(1).max(1000) }).parse(await readJson(req));
  const deleted = await prisma.$transaction(async (tx) => {
    const tasks = await tx.task.findMany({ where: { id: { in: ids }, projectId, deletedAt: null }, select: { id: true, title: true } });
    await tx.task.updateMany({ where: { id: { in: tasks.map((t) => t.id) } }, data: { deletedAt: new Date(), deletedById: user.id } });
    for (const t of tasks) {
      await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "task", entityId: t.id, action: "deleted", summary: `Deleted task "${t.title}"` });
    }
    return tasks.length;
  });
  return NextResponse.json({ deleted });
});

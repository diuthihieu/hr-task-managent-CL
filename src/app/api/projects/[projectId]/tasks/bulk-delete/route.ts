import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfProject, forbidden } from "@/lib/authz";
import { projectCaps } from "@/lib/project-permissions";
import { logActivity } from "@/lib/activity";
import { uuid } from "@/lib/validation";

type P = { projectId: string };

/**
 * Deletes (soft) many tasks of a project. Same rights as deleting one task (assertCanDeleteTask):
 * "delete tasks" in the project plus the edit right on every task - "edit all", or "edit own" for
 * tasks the caller created or is assigned to. Any task outside those rights refuses the whole request.
 */
export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { projectId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfProject(projectId), "contributor");
  const { ids } = z.object({ ids: z.array(uuid).min(1).max(1000) }).parse(await readJson(req));
  const caps = await projectCaps(ctx, projectId);
  if (!caps.has("task.delete")) throw forbidden("You can't delete tasks in this project");
  const deleted = await prisma.$transaction(async (tx) => {
    const tasks = await tx.task.findMany({
      where: { id: { in: ids }, projectId, deletedAt: null },
      select: { id: true, title: true, createdById: true, assignees: { where: { userId: user.id }, select: { userId: true } } },
    });
    if (!caps.has("task.edit_all")) {
      const own = (t: (typeof tasks)[number]) => t.createdById === user.id || t.assignees.length > 0;
      if (!caps.has("task.edit_own") || !tasks.every(own)) throw forbidden("You can only delete tasks you created or are assigned to in this project");
    }
    await tx.task.updateMany({ where: { id: { in: tasks.map((t) => t.id) } }, data: { deletedAt: new Date(), deletedById: user.id } });
    for (const t of tasks) {
      await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "task", entityId: t.id, action: "deleted", summary: `Deleted task "${t.title}"` });
    }
    return tasks.length;
  });
  return NextResponse.json({ deleted });
});

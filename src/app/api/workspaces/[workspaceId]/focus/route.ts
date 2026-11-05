import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, visibleProjectWhere } from "@/lib/authz";
import { badRequest } from "@/lib/http-errors";

type P = { workspaceId: string };

const schema = z.object({ taskId: z.string().uuid().nullable() });

/**
 * Pin (or unpin, taskId null) the caller's "Your focus today" on Home. Only an open task of this workspace
 * assigned to the caller, in a project they can see. The pin lasts until the task is done (Home ignores
 * and clears a pin whose task is no longer open, visible or theirs).
 */
export const PUT = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "viewer");
  const { taskId } = schema.parse(await readJson(req));
  if (taskId) {
    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        workspaceId,
        deletedAt: null,
        project: { deletedAt: null, ...visibleProjectWhere(user) },
        assignees: { some: { userId: user.id } },
        status: { category: { in: ["todo", "in_progress"] } },
      },
      select: { id: true },
    });
    if (!task) throw badRequest("Only an open task assigned to you can be your focus");
  }
  await prisma.workspaceMember.update({ where: { workspaceId_userId: { workspaceId, userId: user.id } }, data: { focusTaskId: taskId } });
  return NextResponse.json({ taskId });
});

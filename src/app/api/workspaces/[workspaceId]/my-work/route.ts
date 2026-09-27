import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route } from "@/lib/authz";
import { resolveTaskProgress } from "@/lib/okr-engine";
import { getMyObjectiveRows } from "@/lib/okr-resolver";
import { fromDateOnly } from "@/lib/task-grid";
import type { MyTaskRow } from "@/types";

type P = { workspaceId: string };

/** Tasks assigned to the caller (one indexed query via task_assignees), plus their OKRs. */
export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "viewer");

  const tasks = await prisma.task.findMany({
    where: { workspaceId, deletedAt: null, project: { deletedAt: null }, assignees: { some: { userId: user.id } } },
    include: {
      project: { select: { id: true, name: true } },
      status: { select: { name: true, category: true } },
      keyResult: { select: { id: true, objectiveId: true } },
    },
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
  });

  const rows: MyTaskRow[] = tasks.map((t) => ({
    projectId: t.project.id,
    projectName: t.project.name,
    taskId: t.id,
    title: t.title,
    status: t.status.name,
    statusCategory: t.status.category,
    priority: t.priority,
    progress: resolveTaskProgress({ progress: t.progress, statusCategory: t.status.category }),
    dueDate: fromDateOnly(t.dueDate),
    importance: t.importance,
    urgency: t.urgency,
    objectiveId: t.objectiveId,
    keyResultId: t.keyResultId,
    contributesToOkr: Boolean(t.objectiveId),
  }));

  const objectives = await getMyObjectiveRows(workspaceId, user.id);
  const keyResults = objectives.flatMap((o) => o.keyResults.map((k) => ({ ...k, objectiveTitle: o.title, objectiveId: o.id })));
  return NextResponse.json({ tasks: rows, objectives, keyResults });
});

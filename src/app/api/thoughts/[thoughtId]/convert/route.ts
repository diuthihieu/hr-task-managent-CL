import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfThought, notFound, badRequest } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { createTask, SYS } from "@/lib/task-grid";
import { uuid } from "@/lib/validation";

type P = { thoughtId: string };

const schema = z.object({
  status: uuid.optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  startAt: z.string().nullable().optional(),
  dueAt: z.string().nullable().optional(),
  output: z.string().max(5000).optional(),
  process: z.string().max(5000).optional(),
  ownerId: uuid.nullable().optional(),
  objectiveId: uuid.nullable().optional(),
  newObjectiveTitle: z.string().max(300).optional(),
  keyResultId: uuid.nullable().optional(),
});

// Clarify -> Convert: the captured thought becomes a real task in its target
// project, in one transaction. The thought row is kept (status=converted,
// converted_task_id) as the audit trail from idea to task.
export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { thoughtId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfThought(thoughtId), "contributor");
  const thought = await prisma.capturedThought.findUnique({ where: { id: thoughtId } });
  if (!thought || thought.userId !== user.id) throw notFound("Thought");
  if (thought.status !== "captured") throw badRequest("This thought was already converted or archived");
  const body = schema.parse(await readJson(req));

  const result = await prisma.$transaction(async (tx) => {
    let objectiveCreated: string | null = null;
    if (!body.objectiveId && body.newObjectiveTitle?.trim()) {
      const o = await tx.objective.create({ data: { workspaceId: ctx.workspaceId, title: body.newObjectiveTitle.trim(), ownerId: user.id, status: "not_started", createdById: user.id, updatedById: user.id } });
      await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "objective", entityId: o.id, action: "created", summary: `Created objective "${o.title}" from quick capture` });
      objectiveCreated = o.id;
    }
    const description = [body.output?.trim() && `Output:\n${body.output.trim()}`, body.process?.trim() && `Execution plan:\n${body.process.trim()}`].filter(Boolean).join("\n\n");
    const data: Record<string, unknown> = {
      [SYS.title]: thought.taskName,
      [SYS.assignees]: [body.ownerId || user.id],
    };
    if (thought.categoryId) data[SYS.category] = thought.categoryId;
    if (thought.estimatedDurationMinutes) data[SYS.estimate] = thought.estimatedDurationMinutes / 60;
    if (body.startAt) data[SYS.startDate] = body.startAt.slice(0, 10);
    if (body.dueAt) data[SYS.dueDate] = body.dueAt.slice(0, 10);
    if (body.status) data[SYS.status] = body.status;
    if (body.priority) data[SYS.priority] = body.priority;
    if (description) data[SYS.description] = description;
    if (body.keyResultId) data[SYS.keyResult] = body.keyResultId;

    const taskId = await createTask(tx, { projectId: thought.projectId, workspaceId: ctx.workspaceId, actorId: user.id, data });
    await tx.capturedThought.update({ where: { id: thoughtId }, data: { status: "converted", convertedTaskId: taskId, convertedAt: new Date() } });
    await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "task", entityId: taskId, action: "created", summary: `Created task "${thought.taskName}" from quick capture` });
    return { taskId, objectiveCreated };
  });
  return NextResponse.json({ taskId: result.taskId, projectId: thought.projectId });
});

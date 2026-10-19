import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfProject, badRequest, assertCanDeleteTask } from "@/lib/authz";
import { assertProjectCap, projectCaps } from "@/lib/project-permissions";
import { rateLimit } from "@/lib/rate-limit";
import { HttpError } from "@/lib/http-errors";
import { uuid } from "@/lib/validation";
import { MAX_TRANSFER_TASKS, duplicateTasks, moveTasks, planTaskTransfer, transferTaskIds, type TaskTransferOptions } from "@/lib/task-transfer";

const schema = z.object({
  sourceProjectId: uuid,
  targetProjectId: uuid,
  taskIds: z.array(uuid).min(1).max(MAX_TRANSFER_TASKS),
  mode: z.enum(["move", "duplicate"]),
  includeComments: z.boolean().default(true),
  includeFiles: z.boolean().default(true),
  /** Only report what would happen (the dialog's preview). */
  dryRun: z.boolean().default(false),
});

/**
 * Move or duplicate selected tasks into another project of the same workspace (see src/lib/task-transfer.ts).
 * Move: the caller may delete every task that goes (sub-tasks included). Duplicate: the caller can see the source project
 * (duplicating inside the same project is allowed). Both: the caller may create tasks in the target; new
 * columns / categories are only created there when the caller may manage them, else those values are left out.
 */
export const POST = route(async (req) => {
  const user = await requireUser();
  const body = schema.parse(await readJson(req));
  if (body.mode === "move" && body.sourceProjectId === body.targetProjectId) throw badRequest("Choose another project");
  const src = await requireWorkspaceRole(user, await workspaceOfProject(body.sourceProjectId), body.mode === "move" ? "contributor" : "viewer");
  const dst = await requireWorkspaceRole(user, await workspaceOfProject(body.targetProjectId), "contributor");
  if (src.workspaceId !== dst.workspaceId) throw badRequest("Tasks can only go to a project in the same workspace");
  if (body.mode === "move") {
    // Moving takes a task out of its project: the caller needs the right to delete each task that goes,
    // sub-tasks included (contributors: only their own / assigned tasks).
    await assertProjectCap(src, body.sourceProjectId, "task.delete");
    for (const id of await transferTaskIds({ sourceProjectId: body.sourceProjectId, taskIds: body.taskIds, mode: "move" })) await assertCanDeleteTask(src, id);
  }
  await assertProjectCap(dst, body.targetProjectId, "task.create");
  const caps = await projectCaps(dst, body.targetProjectId);

  const options: TaskTransferOptions = {
    sourceProjectId: body.sourceProjectId,
    targetProjectId: body.targetProjectId,
    workspaceId: src.workspaceId,
    actorId: user.id,
    taskIds: body.taskIds,
    mode: body.mode,
    includeComments: body.includeComments,
    includeFiles: body.includeFiles,
    createFields: caps.has("fields.manage"),
    createCategories: caps.has("settings.manage"),
  };
  if (body.dryRun) return NextResponse.json(await planTaskTransfer(options));

  // Bulk writes (and file copies in storage) are rate limited per user.
  if (!(await rateLimit(`task-transfer:${user.id}`, 30, 3600_000))) throw new HttpError(429, "Too many move / duplicate operations - try again later");
  const result =
    body.mode === "move"
      ? await prisma.$transaction((tx) => moveTasks(tx, options), { timeout: 120_000, maxWait: 10_000 })
      : await duplicateTasks(options);
  return NextResponse.json(result);
});

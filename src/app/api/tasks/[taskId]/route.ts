import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, requireWorkspaceRole, assertCanEditTask, assertCanDeleteTask, route, readJson, workspaceOfTask, notFound } from "@/lib/authz";
import { loadTaskRecord } from "@/server/tasks/read";
import { softDeleteTask, updateTask } from "@/server/tasks/mutations";

type P = { taskId: string };

export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { taskId } = await params;
  await requireWorkspaceRole(user, await workspaceOfTask(taskId), "viewer");
  const record = await loadTaskRecord(taskId);
  if (!record) throw notFound("Task");
  return NextResponse.json(record);
});

const patchSchema = z.object({
  data: z.record(z.string(), z.unknown()).optional(),
  order: z.number().finite().optional(),
});

export const PATCH = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { taskId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfTask(taskId), "contributor");
  await assertCanEditTask(ctx, taskId);
  return NextResponse.json(await updateTask(ctx, taskId, patchSchema.parse(await readJson(req))));
});

/** Soft delete (restorable via POST /api/tasks/[id]/restore). */
export const DELETE = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { taskId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfTask(taskId), "contributor");
  await assertCanDeleteTask(ctx, taskId);
  await softDeleteTask(ctx, taskId);
  return new NextResponse(null, { status: 204 });
});

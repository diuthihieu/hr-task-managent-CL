import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfProject, notFound } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { loadProjectGrid, createTask, loadTaskRecord } from "@/lib/task-grid";

type P = { projectId: string };

export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { projectId } = await params;
  await requireWorkspaceRole(user, await workspaceOfProject(projectId), "viewer");
  const grid = await loadProjectGrid(projectId);
  if (!grid) throw notFound("Project");
  return NextResponse.json(grid.records);
});

const createSchema = z.object({ data: z.record(z.string(), z.unknown()).default({}) });

export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { projectId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfProject(projectId), "contributor");
  const { data } = createSchema.parse(await readJson(req));
  const record = await prisma.$transaction(async (tx) => {
    const taskId = await createTask(tx, { projectId, workspaceId: ctx.workspaceId, actorId: user.id, data });
    const rec = await loadTaskRecord(taskId, tx);
    await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "task", entityId: taskId, action: "created", summary: `Created task "${rec?.data.sys_title}"` });
    return rec;
  });
  return NextResponse.json(record, { status: 201 });
});

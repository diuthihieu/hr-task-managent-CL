import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfProject, notFound } from "@/lib/authz";
import { HttpError } from "@/lib/http-errors";
import { assertProjectCap } from "@/lib/project-permissions";
import { notifyTaskCreated } from "@/lib/notifications";
import { logActivity } from "@/lib/activity";
import { rateLimit } from "@/lib/rate-limit";
import { createTask, loadTaskRecord } from "@/lib/task-grid";
import { uuid } from "@/lib/validation";

type P = { projectId: string };

const MAX_INSERT_ROWS = 50;

const schema = z.object({
  anchorId: uuid,
  position: z.enum(["above", "below"]),
  count: z.number().int().min(1).max(MAX_INSERT_ROWS),
  /** Values every new row starts with (the group it was inserted in, the anchor's parent...). */
  data: z.record(z.string(), z.unknown()).default({}),
});

/**
 * Inserts `count` new tasks right above / below a task (grid "Insert rows"). Rows after the insertion
 * point move down to make room, all in one transaction, so the new rows keep their place on reload.
 */
export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { projectId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfProject(projectId), "contributor");
  await assertProjectCap(ctx, projectId, "task.create");
  const { anchorId, position, count, data } = schema.parse(await readJson(req));
  if (!(await rateLimit(`task-insert:${user.id}`, 60, 600_000))) throw new HttpError(429, "Too many inserts - try again in a few minutes");

  const records = await prisma.$transaction(async (tx) => {
    // One insert at a time per project, so concurrent inserts cannot interleave their renumbering.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`task-order:${projectId}`}))`;
    const anchor = await tx.task.findFirst({ where: { id: anchorId, projectId, deletedAt: null }, select: { sortOrder: true } });
    if (!anchor) throw notFound("Task");
    // Same ordering as the grid: (sort_order, created_at, id). Compared against the anchor row itself
    // (not a JS Date) so microsecond timestamps cannot misplace it. "above" moves the anchor too.
    const shift = count + 1;
    if (position === "below") {
      await tx.$executeRaw`UPDATE tasks t SET sort_order = t.sort_order + ${shift}
        FROM tasks a WHERE a.id = ${anchorId}::uuid AND t.project_id = ${projectId}::uuid AND t.deleted_at IS NULL
        AND (t.sort_order, t.created_at, t.id) > (a.sort_order, a.created_at, a.id)`;
    } else {
      await tx.$executeRaw`UPDATE tasks t SET sort_order = t.sort_order + ${shift}
        FROM tasks a WHERE a.id = ${anchorId}::uuid AND t.project_id = ${projectId}::uuid AND t.deleted_at IS NULL
        AND (t.sort_order, t.created_at, t.id) >= (a.sort_order, a.created_at, a.id)`;
    }
    const out = [];
    for (let i = 0; i < count; i++) {
      const taskId = await createTask(tx, { projectId, workspaceId: ctx.workspaceId, actorId: user.id, data });
      await tx.task.update({ where: { id: taskId }, data: { sortOrder: anchor.sortOrder + 1 + i } });
      await notifyTaskCreated(tx, taskId, user.id);
      const rec = await loadTaskRecord(taskId, tx);
      await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "task", entityId: taskId, action: "created", summary: `Created task "${rec?.data.sys_title}"` });
      out.push(rec);
    }
    return out;
  }, { timeout: 30_000 });
  return NextResponse.json({ records }, { status: 201 });
});

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfProject, HttpError } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { createTask } from "@/lib/task-grid";

type P = { projectId: string };

const schema = z.object({ rows: z.array(z.record(z.string(), z.unknown())).min(1).max(1000) });

/** Bulk CSV import: all rows validate and commit together, or nothing is written. */
export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { projectId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfProject(projectId), "editor");
  const { rows } = schema.parse(await readJson(req));
  const created = await prisma.$transaction(
    async (tx) => {
      let n = 0;
      for (const [i, data] of rows.entries()) {
        try {
          await createTask(tx, { projectId, workspaceId: ctx.workspaceId, actorId: user.id, data });
        } catch (e) {
          if (e instanceof HttpError) throw new HttpError(e.status, `Row ${i + 2}: ${e.message}`);
          throw e;
        }
        n++;
      }
      await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "project", entityId: projectId, action: "updated", summary: `Imported ${n} task(s) from CSV` });
      return n;
    },
    { timeout: 60_000 }
  );
  return NextResponse.json({ created }, { status: 201 });
});

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfProject, assertCanManageProject, badRequest } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { uuid } from "@/lib/validation";
import { planTransfer, runTransfer } from "@/lib/project-transfer";

type P = { projectId: string };

/** Both projects must be in the same workspace and managed by the caller (project owner or workspace admin). */
async function authorize(projectId: string, targetProjectId: string) {
  const user = await requireUser();
  if (projectId === targetProjectId) throw badRequest("Choose another project");
  const ctx = await requireWorkspaceRole(user, await workspaceOfProject(projectId), "editor");
  const target = await requireWorkspaceRole(user, await workspaceOfProject(targetProjectId), "editor");
  if (target.workspaceId !== ctx.workspaceId) throw badRequest("Data can only be moved to a project in the same workspace");
  await assertCanManageProject(ctx, projectId);
  await assertCanManageProject(target, targetProjectId);
  return { user, ctx };
}

/** Preview: what would move and which columns / categories would be reused or created. */
export const GET = route<P>(async (req, { params }) => {
  const { projectId } = await params;
  const targetProjectId = uuid.parse(new URL(req.url).searchParams.get("targetProjectId"));
  await authorize(projectId, targetProjectId);
  return NextResponse.json(await planTransfer(projectId, targetProjectId));
});

const schema = z.object({ targetProjectId: uuid, includeObjectives: z.boolean().default(true), archiveSource: z.boolean().default(true) });

/** Move everything of this project into the target project (see src/lib/project-transfer.ts). */
export const POST = route<P>(async (req, { params }) => {
  const { projectId } = await params;
  const body = schema.parse(await readJson(req));
  const { user, ctx } = await authorize(projectId, body.targetProjectId);
  const [source, target] = await Promise.all([
    prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { name: true } }),
    prisma.project.findUniqueOrThrow({ where: { id: body.targetProjectId }, select: { name: true } }),
  ]);
  const result = await prisma.$transaction(
    async (tx) => {
      const r = await runTransfer(tx, { sourceId: projectId, targetId: body.targetProjectId, workspaceId: ctx.workspaceId, actorId: user.id, includeObjectives: body.includeObjectives, archiveSource: body.archiveSource });
      const summary = `Moved ${r.tasks} task(s), ${r.objectives} objective(s), ${r.ideas} idea(s) from "${source.name}" to "${target.name}"`;
      await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "project", entityId: projectId, action: "updated", summary, changes: { movedTo: { from: projectId, to: body.targetProjectId } } });
      await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "project", entityId: body.targetProjectId, action: "updated", summary, changes: { movedFrom: { from: projectId, to: body.targetProjectId } } });
      return r;
    },
    { timeout: 120_000, maxWait: 10_000 }
  );
  return NextResponse.json(result);
});

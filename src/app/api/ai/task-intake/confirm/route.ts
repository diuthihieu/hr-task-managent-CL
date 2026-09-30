import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfProject, badRequest } from "@/lib/authz";
import { notifyTaskCreated } from "@/lib/notifications";
import { logActivity } from "@/lib/activity";
import { createTask, loadTaskRecord } from "@/lib/task-grid";
import { draftSchema, intakeScope, sanitizeDraft, draftToTaskData } from "@/lib/ai/task-intake";
import { uuid } from "@/lib/validation";

const schema = z.object({ draft: draftSchema.extend({ projectId: uuid }) });

/**
 * Create the task the user confirmed in the AI chat. The draft is checked
 * again from scratch: contributor access to a project the user can see, and
 * only members / categories that exist - whatever the browser sends.
 */
export const POST = route(async (req) => {
  const user = await requireUser();
  const { draft: raw } = schema.parse(await readJson(req));
  const ctx = await requireWorkspaceRole(user, await workspaceOfProject(raw.projectId), "contributor");
  const scope = await intakeScope(user, ctx.workspaceId, ctx.role, raw.projectId);
  const draft = sanitizeDraft(raw, scope);
  if (draft.missing.length) throw badRequest(`Missing: ${draft.missing.join(", ")}`);
  const dropped = (raw.assigneeIds?.length ?? 0) !== draft.assignees.length || (raw.reportToIds?.length ?? 0) !== draft.reportTo.length;
  if (dropped) throw badRequest("Some people are not active members of this workspace");
  const data = draftToTaskData(draft, user.locale === "en" ? "en" : "vi");
  const record = await prisma.$transaction(async (tx) => {
    const taskId = await createTask(tx, { projectId: draft.projectId!, workspaceId: ctx.workspaceId, actorId: user.id, data });
    await notifyTaskCreated(tx, taskId, user.id);
    const rec = await loadTaskRecord(taskId, tx);
    await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "task", entityId: taskId, action: "created", summary: `Created task "${draft.title}" with woli AI` });
    return rec;
  });
  const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId }, select: { slug: true } });
  return NextResponse.json({ record, projectId: draft.projectId, href: `/w/${ws.slug}/p/${draft.projectId}/t/${record?.id}` }, { status: 201 });
});

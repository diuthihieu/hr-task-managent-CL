import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, assertCanEditTask, route, readJson, workspaceOfTask, badRequest, HttpError } from "@/lib/authz";
import { uuid } from "@/lib/validation";
import { logActivity } from "@/lib/activity";
import { APPROVAL_SELECT } from "@/lib/approvals";

type P = { taskId: string };


/** Approval requests on a task, newest first. */
export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { taskId } = await params;
  await requireWorkspaceRole(user, await workspaceOfTask(taskId), "viewer");
  return NextResponse.json(await prisma.taskApproval.findMany({ where: { taskId }, orderBy: { createdAt: "desc" }, select: APPROVAL_SELECT }));
});

const schema = z.object({
  approverId: uuid,
  note: z.string().trim().max(2000).optional(),
  completeOnApprove: z.boolean().optional(),
});

/**
 * Ask someone to approve this task (anyone who can edit it may ask). The
 * approver must be able to see the task's project; they get an
 * `approval_request` in their Action Center with Approve / Reject.
 */
export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { taskId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfTask(taskId), "contributor");
  await assertCanEditTask(ctx, taskId);
  const body = schema.parse(await readJson(req));
  if (body.approverId === user.id) throw badRequest("Choose someone else to approve");
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, select: { title: true, projectId: true, workspace: { select: { slug: true } } } });
  const member = await prisma.workspaceMember.findFirst({ where: { workspaceId: ctx.workspaceId, userId: body.approverId, user: { isActive: true, deletedAt: null } }, select: { id: true } });
  const hidden = await prisma.projectHiddenMember.findFirst({ where: { projectId: task.projectId, userId: body.approverId }, select: { projectId: true } });
  if (!member || hidden) throw badRequest("The approver must be a member who can see this project");
  if (await prisma.taskApproval.findFirst({ where: { taskId, approverId: body.approverId, status: "pending" }, select: { id: true } })) throw new HttpError(409, "This person already has a pending request for this task");
  const approval = await prisma.$transaction(async (tx) => {
    const a = await tx.taskApproval.create({
      data: { workspaceId: ctx.workspaceId, taskId, requestedById: user.id, approverId: body.approverId, note: body.note || null, completeOnApprove: body.completeOnApprove ?? false },
      select: APPROVAL_SELECT,
    });
    await tx.notification.create({
      data: {
        userId: body.approverId,
        workspaceId: ctx.workspaceId,
        projectId: task.projectId,
        taskId,
        actorId: user.id,
        type: "approval_request",
        title: task.title,
        body: body.note || null,
        data: { approvalId: a.id },
        link: `/w/${task.workspace.slug}/p/${task.projectId}/t/${taskId}`,
      },
    });
    await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "task", entityId: taskId, action: "updated", summary: `Requested approval from ${a.approver.name}` });
    return a;
  });
  return NextResponse.json(approval, { status: 201 });
});

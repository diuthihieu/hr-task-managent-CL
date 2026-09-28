import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfTask, notFound, forbidden, badRequest } from "@/lib/authz";
import { applyTaskPatch, SYS } from "@/lib/task-grid";
import { notifyTaskPatched } from "@/lib/notifications";
import { logActivity } from "@/lib/activity";
import { APPROVAL_SELECT } from "@/lib/approvals";

type P = { approvalId: string };

const schema = z.object({
  decision: z.enum(["approve", "reject", "cancel"]),
  note: z.string().trim().max(2000).optional(),
});

/**
 * Decide on an approval: the approver approves or rejects (optionally with a
 * note); the requester can cancel. Approving can also complete the task when
 * the request asked for it - the approver's sign-off is the authority for it.
 */
export const PATCH = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { approvalId } = await params;
  const a = await prisma.taskApproval.findUnique({ where: { id: approvalId }, include: { task: { select: { id: true, title: true, projectId: true, workspace: { select: { slug: true } } } } } });
  if (!a) throw notFound("Approval");
  const ctx = await requireWorkspaceRole(user, await workspaceOfTask(a.taskId), "viewer");
  const body = schema.parse(await readJson(req));
  if (a.status !== "pending") throw badRequest("This request was already decided");
  if (body.decision === "cancel" ? a.requestedById !== user.id : a.approverId !== user.id) throw forbidden(body.decision === "cancel" ? "Only the requester can cancel" : "Only the approver can decide");
  const status = body.decision === "approve" ? "approved" : body.decision === "reject" ? "rejected" : "cancelled";
  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.taskApproval.update({ where: { id: approvalId }, data: { status, decisionNote: body.note || null, decidedAt: now }, select: APPROVAL_SELECT });
    // The approver's request leaves their To do list.
    await tx.notification.updateMany({ where: { type: "approval_request", userId: a.approverId, data: { path: ["approvalId"], equals: approvalId } }, data: { actionedAt: now, readAt: now } });
    if (status !== "cancelled" && a.requestedById) {
      await tx.notification.create({
        data: {
          userId: a.requestedById,
          workspaceId: ctx.workspaceId,
          projectId: a.task.projectId,
          taskId: a.taskId,
          actorId: user.id,
          type: "approval_result",
          title: a.task.title,
          body: body.note || null,
          data: { approvalId, decision: status },
          link: `/w/${a.task.workspace.slug}/p/${a.task.projectId}/t/${a.taskId}`,
        },
      });
    }
    if (status === "approved" && a.completeOnApprove) {
      const done = await tx.status.findFirst({ where: { workspaceId: ctx.workspaceId, category: "done" }, orderBy: { sortOrder: "asc" } });
      if (done) {
        const res = await applyTaskPatch(tx, { taskId: a.taskId, projectId: a.task.projectId, workspaceId: ctx.workspaceId, actorId: user.id, data: { [SYS.status]: done.id } });
        if (Object.keys(res.changes).length) await notifyTaskPatched(tx, { taskId: a.taskId, actorId: user.id, changedKeys: Object.keys(res.changes), statusChanged: res.statusChanged, newStatusName: res.newStatusName, assigned: [], reportAdded: [] });
      }
    }
    await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "task", entityId: a.taskId, action: "updated", summary: `Approval ${status}${body.note ? `: ${body.note}` : ""}` });
    return u;
  });
  return NextResponse.json(updated);
});

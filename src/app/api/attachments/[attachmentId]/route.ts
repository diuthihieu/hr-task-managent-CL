import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, assertCanEditTask, route, workspaceOfAttachment } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { deleteAttachmentBlob } from "@/lib/storage";

type P = { attachmentId: string };

/** Soft-deletes the metadata row and removes the bytes from object storage. */
export const DELETE = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { attachmentId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfAttachment(attachmentId), "contributor");
  const a = await prisma.attachment.findUniqueOrThrow({ where: { id: attachmentId } });
  await assertCanEditTask(ctx, a.taskId);
  await prisma.$transaction(async (tx) => {
    await tx.attachment.update({ where: { id: attachmentId }, data: { deletedAt: new Date() } });
    await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "task", entityId: a.taskId, action: "updated", summary: `Removed attachment "${a.fileName}"` });
  });
  await deleteAttachmentBlob(a.url).catch((e) => console.error("blob delete failed", e));
  return new NextResponse(null, { status: 204 });
});

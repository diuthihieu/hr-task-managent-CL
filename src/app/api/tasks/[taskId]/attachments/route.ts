import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, assertCanEditTask, route, workspaceOfTask, badRequest } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { notifyTaskDetail } from "@/lib/notifications";
import { assertUploadAllowed, assertUploadQuota, safeContentType, uploadAttachment, deleteAttachmentBlob, safeFileName } from "@/lib/storage";
import type { AttachmentRow } from "@/types";

type P = { taskId: string };

type Row = { id: string; fileName: string; contentType: string; sizeBytes: number; storageKey: string; createdAt: Date; uploadedBy: { id: string; name: string } | null };
const toRow = (a: Row): AttachmentRow & { uploadKey: string } => {
  const { storageKey, ...row } = a;
  return { ...row, uploadKey: storageKey, createdAt: a.createdAt.toISOString(), downloadUrl: `/api/attachments/${a.id}/download` };
};
const select = { id: true, fileName: true, contentType: true, sizeBytes: true, storageKey: true, createdAt: true, uploadedBy: { select: { id: true, name: true } } } as const;

export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { taskId } = await params;
  await requireWorkspaceRole(user, await workspaceOfTask(taskId), "viewer");
  const rows = await prisma.attachment.findMany({ where: { taskId, deletedAt: null }, orderBy: { createdAt: "desc" }, select });
  return NextResponse.json(rows.map(toRow));
});

/** multipart/form-data with a single `file` part. */
export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { taskId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfTask(taskId), "contributor");
  await assertCanEditTask(ctx, taskId);
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw badRequest("Send the file as multipart form field `file`");
  assertUploadAllowed(file);
  await assertUploadQuota(user.id);

  const blob = await uploadAttachment({ workspaceId: ctx.workspaceId, taskId, file });
  try {
    const row = await prisma.$transaction(async (tx) => {
      const a = await tx.attachment.create({
        data: {
          workspaceId: ctx.workspaceId,
          taskId,
          fileName: safeFileName(file.name),
          contentType: safeContentType(file),
          sizeBytes: file.size,
          storageProvider: blob.provider,
          storageKey: blob.pathname,
          url: blob.url,
          uploadedById: user.id,
        },
        select,
      });
      await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "task", entityId: taskId, action: "updated", summary: `Attached "${a.fileName}"` });
      await notifyTaskDetail(tx, taskId, user.id, "attachments");
      return a;
    });
    return NextResponse.json(toRow(row), { status: 201 });
  } catch (e) {
    // Don't leave an orphaned blob when the metadata insert fails.
    await deleteAttachmentBlob(blob.url).catch(() => {});
    throw e;
  }
});

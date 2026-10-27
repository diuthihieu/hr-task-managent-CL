import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, workspaceOfTask, badRequest } from "@/lib/authz";
import { assertProjectCap } from "@/lib/project-permissions";
import { logActivity } from "@/lib/activity";
import { assertUploadAllowed, assertUploadQuota, uploadAttachment, deleteAttachmentBlob, safeFileName } from "@/lib/storage";
import { commentImageUrl } from "@/lib/comment-images";

type P = { taskId: string };

/** The real type from the first bytes: only PNG, JPEG, GIF and WebP (never SVG / HTML posing as an image). */
function sniffImage(head: Uint8Array): string | null {
  const at = (i: number, ...bytes: number[]) => bytes.every((b, k) => head[i + k] === b);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return null;
}
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

/**
 * An image pasted / dropped / picked in a task comment. Anyone who may comment on the task may send one
 * (viewers included), so this does not need the "edit task" right that the Files tab does - but it only
 * takes real images. The image is saved as a file of the task and shown inline in the comment.
 */
export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { taskId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfTask(taskId), "viewer");
  if (ctx.projectId) await assertProjectCap(ctx, ctx.projectId, "task.comment");
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw badRequest("Send the image as multipart form field `file`");
  const type = sniffImage(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
  if (!type) throw badRequest("Only PNG, JPG, GIF or WebP images can be added to a comment");
  assertUploadAllowed(file);
  await assertUploadQuota(user.id);

  const base = safeFileName(file.name || "image").replace(/\.[a-z0-9]{1,5}$/i, "") || "image";
  const named = new File([file], `${base}.${EXT[type]}`, { type });
  const blob = await uploadAttachment({ workspaceId: ctx.workspaceId, taskId, file: named });
  try {
    const a = await prisma.$transaction(async (tx) => {
      const row = await tx.attachment.create({
        data: { workspaceId: ctx.workspaceId, taskId, fileName: named.name, contentType: type, sizeBytes: file.size, storageProvider: blob.provider, storageKey: blob.pathname, url: blob.url, uploadedById: user.id },
        select: { id: true, fileName: true },
      });
      await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "task", entityId: taskId, action: "updated", summary: `Added image "${row.fileName}" to a comment` });
      return row;
    });
    return NextResponse.json({ id: a.id, fileName: a.fileName, url: commentImageUrl(a.id) }, { status: 201 });
  } catch (e) {
    await deleteAttachmentBlob(blob.url).catch(() => {});
    throw e;
  }
});

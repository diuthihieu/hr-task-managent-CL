import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, workspaceOfWikiPage, badRequest } from "@/lib/authz";
import { assertUploadAllowed, uploadAttachment, deleteAttachmentBlob, safeFileName } from "@/lib/storage";

type P = { pageId: string };

/** Upload a file (usually an image) embedded in a wiki page. multipart/form-data, field `file`. */
export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { pageId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfWikiPage(pageId), "contributor");
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw badRequest("Send the file as multipart form field `file`");
  assertUploadAllowed(file);
  const blob = await uploadAttachment({ workspaceId: ctx.workspaceId, wikiPageId: pageId, file });
  try {
    const a = await prisma.attachment.create({
      data: {
        workspaceId: ctx.workspaceId,
        wikiPageId: pageId,
        fileName: safeFileName(file.name),
        contentType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        storageProvider: "vercel_blob",
        storageKey: blob.pathname,
        url: blob.url,
        uploadedById: user.id,
      },
      select: { id: true, fileName: true, contentType: true, sizeBytes: true },
    });
    return NextResponse.json({ ...a, downloadUrl: `/api/attachments/${a.id}/download`, inlineUrl: `/api/attachments/${a.id}/download?inline=1` }, { status: 201 });
  } catch (e) {
    await deleteAttachmentBlob(blob.url).catch(() => {});
    throw e;
  }
});

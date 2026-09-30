import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, workspaceOfWikiPage, badRequest, forbidden, wikiRoleAtLeast } from "@/lib/authz";
import { assertUploadAllowed, assertUploadQuota, safeContentType, uploadAttachment, deleteAttachmentBlob, safeFileName } from "@/lib/storage";

type P = { pageId: string };

/** Upload a file (usually an image) embedded in a wiki page. multipart/form-data, field `file`. */
export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { pageId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfWikiPage(pageId), "viewer");
  const form = await req.formData().catch(() => null);
  // Page images need edit rights; files for a comment only need read access (anyone who can read can comment).
  if (form?.get("purpose") !== "comment" && !wikiRoleAtLeast(ctx.wikiRole, "editor")) throw forbidden("You can only read this wiki");
  const file = form?.get("file");
  if (!(file instanceof File)) throw badRequest("Send the file as multipart form field `file`");
  assertUploadAllowed(file);
  await assertUploadQuota(user.id);
  const blob = await uploadAttachment({ workspaceId: ctx.workspaceId, wikiPageId: pageId, file });
  try {
    const a = await prisma.attachment.create({
      data: {
        workspaceId: ctx.workspaceId,
        wikiPageId: pageId,
        fileName: safeFileName(file.name),
        contentType: safeContentType(file),
        sizeBytes: file.size,
        storageProvider: blob.provider,
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

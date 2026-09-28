import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, workspaceOfAttachment, notFound } from "@/lib/authz";
import { openAttachment } from "@/lib/storage";

type P = { attachmentId: string };

// Raster images may be shown inline (thumbnails, images in record/wiki
// pages). Everything else is always a download; SVG/HTML are rejected at
// upload time anyway.
const INLINE_TYPES = /^image\/(png|jpe?g|gif|webp|avif|bmp)$/i;

/** Streams a private blob to an authorized workspace member. */
export const GET = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { attachmentId } = await params;
  await requireWorkspaceRole(user, await workspaceOfAttachment(attachmentId), "viewer");
  const a = await prisma.attachment.findUniqueOrThrow({ where: { id: attachmentId } });
  const blob = await openAttachment(a.url, a.storageProvider);
  if (!blob) throw notFound("File");
  const inline = new URL(req.url).searchParams.get("inline") === "1" && INLINE_TYPES.test(a.contentType);
  return new Response(blob.stream, {
    headers: {
      "Content-Type": a.contentType,
      "Content-Length": String(a.sizeBytes),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.fileName)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": inline ? "private, max-age=600" : "private, no-store",
    },
  });
});

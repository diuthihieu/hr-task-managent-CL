import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, workspaceOfAttachment, notFound, badRequest, HttpError } from "@/lib/authz";
import { openAttachment } from "@/lib/storage";
import { sanitizeRichText } from "@/lib/rich-text";
import { pptxSlides } from "@/lib/ai/extract";

type P = { attachmentId: string };

export const maxDuration = 30;
const MAX_PREVIEW_BYTES = 15 * 1024 * 1024;

/**
 * In-app preview of Office files: Word (.docx) as sanitized HTML (headings,
 * lists, tables, bold/italic; images left out), PowerPoint (.pptx) as the
 * text of each slide with its speaker notes. Same access as downloading.
 */
export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { attachmentId } = await params;
  await requireWorkspaceRole(user, await workspaceOfAttachment(attachmentId), "viewer");
  const a = await prisma.attachment.findUniqueOrThrow({ where: { id: attachmentId } });
  const kind = /\.docx$/i.test(a.fileName) ? "docx" : /\.pptx$/i.test(a.fileName) ? "pptx" : null;
  if (!kind) throw badRequest("Preview is available for .docx and .pptx files");
  if (a.sizeBytes > MAX_PREVIEW_BYTES) throw new HttpError(413, "File is too large to preview - download it instead");
  const blob = await openAttachment(a.url, a.storageProvider);
  if (!blob) throw notFound("File");
  const buf = Buffer.from(await new Response(blob.stream).arrayBuffer());
  try {
    if (kind === "docx") {
      const mammoth = await import("mammoth");
      // Images are dropped (the sanitizer blocks external / data images anyway).
      const { value } = await mammoth.convertToHtml({ buffer: buf }, { convertImage: mammoth.images.imgElement(async () => ({ src: "" })) });
      return NextResponse.json({ kind, html: sanitizeRichText(value.replace(/<img[^>]*>/g, "")) ?? "" }, { headers: { "Cache-Control": "private, max-age=300" } });
    }
    return NextResponse.json({ kind, slides: await pptxSlides(buf) }, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch {
    throw badRequest("This file couldn't be read - it may be damaged or password-protected");
  }
});

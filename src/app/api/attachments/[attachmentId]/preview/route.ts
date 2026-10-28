import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, workspaceOfAttachment, notFound, badRequest, HttpError } from "@/lib/authz";
import { openAttachment } from "@/lib/storage";
import { sanitizeRichText } from "@/lib/rich-text";
import { pptxSlides } from "@/lib/ai/extract";
import { assertOfficePreviewable, ZipRejected } from "@/lib/zip-guard";
import { rateLimit } from "@/lib/rate-limit";

type P = { attachmentId: string };

export const maxDuration = 30;
const MAX_PREVIEW_BYTES = 15 * 1024 * 1024;
// Parsing a preview can take hundreds of MB of memory: one at a time per server process.
let running = 0;

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
  if (!(await rateLimit(`preview:${user.id}`, 30, 10 * 60_000))) throw new HttpError(429, "Too many previews - please wait a few minutes");
  if (running > 0) throw new HttpError(429, "Another preview is being prepared - try again in a moment");
  running++;
  try {
    return await preview(a.url, a.storageProvider, kind);
  } finally {
    running--;
  }
});

async function preview(url: string, storageProvider: Parameters<typeof openAttachment>[1], kind: "docx" | "pptx") {
  const blob = await openAttachment(url, storageProvider);
  if (!blob) throw notFound("File");
  const buf = Buffer.from(await new Response(blob.stream).arrayBuffer());
  // Checked before any parser runs (and outside the catch below, so its message reaches the user):
  // real expanded sizes, a structure JSZip reads the same way, at most 5 MB of XML.
  try {
    assertOfficePreviewable(buf);
  } catch (e) {
    throw badRequest(e instanceof ZipRejected ? e.message : "This file couldn't be read - it may be damaged or password-protected");
  }
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
}

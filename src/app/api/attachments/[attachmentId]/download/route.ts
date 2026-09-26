import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, workspaceOfAttachment, notFound } from "@/lib/authz";
import { openAttachment } from "@/lib/storage";

type P = { attachmentId: string };

/** Streams a private blob to an authorized workspace member. Always as a download, never rendered inline. */
export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { attachmentId } = await params;
  await requireWorkspaceRole(user, await workspaceOfAttachment(attachmentId), "viewer");
  const a = await prisma.attachment.findUniqueOrThrow({ where: { id: attachmentId } });
  const blob = await openAttachment(a.url);
  if (!blob) throw notFound("File");
  return new Response(blob.stream, {
    headers: {
      "Content-Type": a.contentType,
      "Content-Length": String(a.sizeBytes),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(a.fileName)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
});

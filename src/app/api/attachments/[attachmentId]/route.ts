import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, assertCanEditTask, route, workspaceOfAttachment, roleAtLeast, forbidden, wikiRoleAtLeast } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { deleteAttachmentBlob } from "@/lib/storage";

type P = { attachmentId: string };

/** Soft-deletes the metadata row and removes the bytes from object storage. */
export const DELETE = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { attachmentId } = await params;
  // Resolve access first (membership, hidden projects, wiki membership), then apply the right role:
  // task files follow task edit rights; wiki files follow the WIKI role, not the workspace role.
  const ctx = await requireWorkspaceRole(user, await workspaceOfAttachment(attachmentId), "viewer");
  const a = await prisma.attachment.findUniqueOrThrow({ where: { id: attachmentId } });
  if (a.taskId) {
    if (!roleAtLeast(ctx.role, "contributor")) throw forbidden();
    await assertCanEditTask(ctx, a.taskId);
  } else if (!wikiRoleAtLeast(ctx.wikiRole, "editor")) throw forbidden("Only wiki editors can remove files");
  await prisma.$transaction(async (tx) => {
    await tx.attachment.update({ where: { id: attachmentId }, data: { deletedAt: new Date() } });
    await logActivity(tx, {
      workspaceId: ctx.workspaceId,
      actorId: user.id,
      entityType: a.taskId ? "task" : "wiki_page",
      entityId: (a.taskId ?? a.wikiPageId)!,
      action: "updated",
      summary: `Removed attachment "${a.fileName}"`,
    });
  });
  await deleteAttachmentBlob(a.url).catch((e) => console.error("blob delete failed", e));
  return new NextResponse(null, { status: 204 });
});

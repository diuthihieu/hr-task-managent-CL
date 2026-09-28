import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, workspaceOfWikiPage, notFound, forbidden, wikiRoleAtLeast } from "@/lib/authz";

type P = { commentId: string };

/** Delete a wiki comment: its author, or a manager of the wiki. */
export const DELETE = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { commentId } = await params;
  const c = await prisma.wikiComment.findFirst({ where: { id: commentId, deletedAt: null }, select: { authorId: true, wikiPageId: true } });
  if (!c) throw notFound("Comment");
  const ctx = await requireWorkspaceRole(user, await workspaceOfWikiPage(c.wikiPageId), "viewer");
  if (c.authorId !== user.id && !wikiRoleAtLeast(ctx.wikiRole, "manager")) throw forbidden("Only the author or a wiki manager can delete this comment");
  await prisma.$transaction([
    prisma.wikiComment.update({ where: { id: commentId }, data: { deletedAt: new Date() } }),
    prisma.attachment.updateMany({ where: { wikiCommentId: commentId }, data: { deletedAt: new Date() } }),
  ]);
  return new NextResponse(null, { status: 204 });
});

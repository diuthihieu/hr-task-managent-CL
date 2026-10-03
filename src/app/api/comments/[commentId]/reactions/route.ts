import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfComment, notFound } from "@/lib/authz";
import { COMMENT_REACTIONS, summarizeCommentReactions } from "@/lib/comment-reactions";
import { logActivity } from "@/lib/activity";

type P = { commentId: string };
const schema = z.object({ emoji: z.enum(COMMENT_REACTIONS) });

/** Toggle one allowlisted emoji. Everyone who may read the Task may react. */
export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { commentId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfComment(commentId), "viewer");
  const { emoji } = schema.parse(await readJson(req));
  const comment = await prisma.comment.findFirst({ where: { id: commentId, deletedAt: null }, select: { id: true } });
  if (!comment) throw notFound("Comment");

  const reactions = await prisma.$transaction(async (tx) => {
    const key = { commentId_userId_emoji: { commentId, userId: user.id, emoji } };
    const existing = await tx.commentReaction.findUnique({ where: key, select: { commentId: true } });
    if (existing) await tx.commentReaction.delete({ where: key });
    else await tx.commentReaction.create({ data: { commentId, userId: user.id, emoji } });
    await logActivity(tx, {
      workspaceId: ctx.workspaceId,
      actorId: user.id,
      entityType: "comment",
      entityId: commentId,
      action: "updated",
      summary: existing ? `Removed ${emoji} reaction` : `Reacted ${emoji}`,
      changes: { reaction: { from: existing ? emoji : null, to: existing ? null : emoji } },
    });
    return tx.commentReaction.findMany({ where: { commentId }, orderBy: { createdAt: "asc" }, select: { emoji: true, userId: true, user: { select: { name: true } } } });
  });

  return NextResponse.json(summarizeCommentReactions(reactions, user.id));
});

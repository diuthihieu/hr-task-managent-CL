import { NextResponse } from "next/server";
import { withCurrentMentionNames } from "@/lib/mentions-server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfTask, badRequest } from "@/lib/authz";
import { notifyTaskComment } from "@/lib/notifications";
import { logActivity } from "@/lib/activity";
import { uuid } from "@/lib/validation";
import { mentionedUserIds, stripMentions } from "@/lib/mentions";
import { sanitizeCommentBody } from "@/lib/comment-rich-text-server";
import { summarizeCommentReactions } from "@/lib/comment-reactions";

type P = { taskId: string };

const select = {
  id: true,
  body: true,
  parentCommentId: true,
  createdAt: true,
  updatedAt: true,
  author: { select: { id: true, name: true, avatarColor: true } },
  reactions: { orderBy: { createdAt: "asc" as const }, select: { emoji: true, userId: true, user: { select: { name: true } } } },
} as const;

function serializeComment<T extends { author: unknown; reactions: { emoji: string; userId: string; user: { name: string } }[] }>(comment: T, currentUserId: string) {
  const { author, reactions, ...rest } = comment;
  return { ...rest, user: author, reactions: summarizeCommentReactions(reactions, currentUserId) };
}

export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { taskId } = await params;
  await requireWorkspaceRole(user, await workspaceOfTask(taskId), "viewer");
  const comments = await prisma.comment.findMany({ where: { taskId, deletedAt: null }, orderBy: { createdAt: "asc" }, select });
  return NextResponse.json((await withCurrentMentionNames(comments)).map((comment) => serializeComment(comment, user.id)));
});

const createSchema = z.object({ body: z.string().trim().min(1, "Comment cannot be empty").max(10000), parentCommentId: uuid.nullable().optional() });

/** Everyone who can see the task (viewers included) can comment. */
export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { taskId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfTask(taskId), "viewer");
  const body = createSchema.parse(await readJson(req));
  const commentBody = sanitizeCommentBody(body.body);
  let parentCommentId: string | null = null;
  if (body.parentCommentId) {
    const parent = await prisma.comment.findFirst({ where: { id: body.parentCommentId, taskId, deletedAt: null }, select: { id: true, parentCommentId: true } });
    if (!parent) throw badRequest("Parent comment not found");
    // Replying to a reply joins the same thread (one level, like a chat thread).
    parentCommentId = parent.parentCommentId ?? parent.id;
  }
  // Only people who can see the task can be tagged; unknown ids are ignored.
  const wanted = mentionedUserIds(commentBody);
  const mentioned = wanted.length
    ? (
        await prisma.workspaceMember.findMany({
          where: { workspaceId: ctx.workspaceId, userId: { in: wanted }, user: { isActive: true, hiddenProjects: { none: { projectId: ctx.projectId } } } },
          select: { userId: true },
        })
      ).map((m) => m.userId)
    : [];
  const comment = await prisma.$transaction(async (tx) => {
    const c = await tx.comment.create({ data: { taskId, authorId: user.id, body: commentBody, parentCommentId }, select });
    if (mentioned.length) await tx.commentMention.createMany({ data: mentioned.map((userId) => ({ commentId: c.id, userId })), skipDuplicates: true });
    await notifyTaskComment(tx, { taskId, actorId: user.id, excerpt: stripMentions(commentBody), mentioned });
    await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "comment", entityId: c.id, action: "created", summary: `Commented on task`, changes: { taskId: { from: null, to: taskId } } });
    return c;
  });
  return NextResponse.json(serializeComment(comment, user.id), { status: 201 });
});

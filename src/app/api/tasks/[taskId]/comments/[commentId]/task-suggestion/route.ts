import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, workspaceOfTask, notFound, forbidden } from "@/lib/authz";
import { aiConfigured } from "@/lib/ai/gemini";
import { suggestTaskFromComment } from "@/lib/ai/comment-task";
import { rateLimit } from "@/lib/rate-limit";

export const maxDuration = 60;

type P = { taskId: string; commentId: string };

/**
 * AI check of a comment the caller just wrote: does it ask for / commit to new work? Answers a proposal
 * the commenter can confirm (see src/lib/ai/comment-task.ts). Only the comment's author may ask. When AI
 * is off, unavailable or rate limited the answer is simply "no suggestion" - commenting is never disturbed.
 */
export const POST = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { taskId, commentId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfTask(taskId), "viewer");
  const comment = await prisma.comment.findFirst({
    where: { id: commentId, taskId, deletedAt: null },
    select: { id: true, body: true, taskId: true, authorId: true, task: { select: { id: true, title: true, projectId: true, project: { select: { name: true } } } } },
  });
  if (!comment) throw notFound("Comment");
  if (comment.authorId !== user.id) throw forbidden("Only the comment's author can turn it into a task");
  if (!aiConfigured()) return NextResponse.json({ suggest: false, reason: "ai_off" });
  if (!(await rateLimit(`ai-comment-task:${user.id}`, 20, 10 * 60_000)) || !(await rateLimit(`ai-comment-task-day:${user.id}`, 150, 24 * 3600_000))) {
    return NextResponse.json({ suggest: false, reason: "rate_limited" });
  }
  try {
    const result = await suggestTaskFromComment({
      user,
      ctx,
      comment: { id: comment.id, body: comment.body, taskId: comment.taskId },
      task: { id: comment.task.id, title: comment.task.title, projectId: comment.task.projectId, projectName: comment.task.project.name },
    });
    return NextResponse.json(result);
  } catch (e) {
    console.error("[comment-task] AI suggestion failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ suggest: false, reason: "ai_error" });
  }
});

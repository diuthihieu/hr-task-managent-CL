import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { stripMentions } from "@/lib/mentions";

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The most recent task comments matching `where` (the caller scopes it to tasks
 * the user can see), newest first, one line each, for the AI's DATA block:
 * "date | author | project › task: text". Without this the model only sees a
 * task's notes and answers "nobody commented" when people did.
 */
export async function taskCommentsSection(where: Prisma.CommentWhereInput, opts: { limit?: number; maxChars?: number } = {}): Promise<string> {
  const limit = opts.limit ?? 400;
  const comments = await prisma.comment.findMany({
    where: { deletedAt: null, ...where },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { body: true, createdAt: true, parentCommentId: true, author: { select: { name: true } }, task: { select: { title: true, project: { select: { name: true } } } } },
  });
  if (!comments.length) return "## Task comments\n(none)";
  const maxChars = opts.maxChars ?? 400;
  const lines = comments.map((c) => {
    const text = stripMentions(c.body).replace(/\s+/g, " ").trim();
    const clipped = text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
    return `- ${day(c.createdAt)} | ${c.author?.name ?? "(deleted user)"} | ${c.task.project.name} › ${c.task.title}${c.parentCommentId ? " (reply)" : ""}: ${clipped}`;
  });
  return `## Task comments (${comments.length}${comments.length === limit ? ", most recent" : ""}; newest first)\ndate | author | project › task: comment\n${lines.join("\n")}`;
}

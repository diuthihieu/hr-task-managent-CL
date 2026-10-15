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
 * `maxTotalChars` bounds the whole section (newest comments are kept), so it can
 * sit next to the task list without crowding it out of the context budget.
 */
export async function taskCommentsSection(where: Prisma.CommentWhereInput, opts: { limit?: number; maxChars?: number; maxTotalChars?: number } = {}): Promise<string> {
  const limit = opts.limit ?? 400;
  const comments = await prisma.comment.findMany({
    where: { deletedAt: null, ...where },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { body: true, createdAt: true, parentCommentId: true, author: { select: { name: true } }, task: { select: { title: true, project: { select: { name: true } } } } },
  });
  if (!comments.length) return "## Task comments\n(none)";
  const maxChars = opts.maxChars ?? 400;
  const maxTotal = opts.maxTotalChars ?? 60_000;
  const lines: string[] = [];
  let used = 0;
  for (const c of comments) {
    const text = stripMentions(c.body).replace(/\s+/g, " ").trim();
    const clipped = text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
    const line = `- ${day(c.createdAt)} | ${c.author?.name ?? "(deleted user)"} | ${c.task.project.name} › ${c.task.title}${c.parentCommentId ? " (reply)" : ""}: ${clipped}`;
    if (used + line.length + 1 > maxTotal) break;
    lines.push(line);
    used += line.length + 1;
  }
  const partial = lines.length < comments.length || comments.length === limit;
  return `## Task comments (${lines.length}${partial ? ", most recent only" : ""}; newest first)\ndate | author | project › task: comment\n${lines.join("\n")}`;
}

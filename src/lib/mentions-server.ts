import "server-only";
import { prisma } from "./prisma";
import { MENTION_RE, RICH_MENTION_RE, mentionToken, mentionedUserIds, richMentionHtml } from "./mentions";

/**
 * Mentions store the name at the time of writing; show the person's current
 * display name instead, so a renamed colleague isn't shown under an old name.
 */
export async function withCurrentMentionNames<T extends { body: string }>(rows: T[]): Promise<T[]> {
  const ids = [...new Set(rows.flatMap((r) => mentionedUserIds(r.body)))];
  if (!ids.length) return rows;
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id.toLowerCase(), u.name]));
  return rows.map((r) => ({
    ...r,
    body: r.body
      .replace(MENTION_RE, (match, _old: string, id: string) => (names.has(id.toLowerCase()) ? mentionToken(names.get(id.toLowerCase())!, id) : match))
      .replace(RICH_MENTION_RE, (match, id: string) => (names.has(id.toLowerCase()) ? richMentionHtml(names.get(id.toLowerCase())!, id) : match)),
  }));
}

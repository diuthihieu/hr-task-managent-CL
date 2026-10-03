export const COMMENT_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "👏"] as const;
export type CommentReactionEmoji = (typeof COMMENT_REACTIONS)[number];

export interface CommentReactionSummary {
  emoji: CommentReactionEmoji;
  count: number;
  mine: boolean;
  names: string[];
}

interface ReactionRow {
  emoji: string;
  userId: string;
  user: { name: string };
}

/** Stable, allowlisted reaction groups for API responses and the comment UI. */
export function summarizeCommentReactions(rows: ReactionRow[], currentUserId: string): CommentReactionSummary[] {
  const allowed = new Set<string>(COMMENT_REACTIONS);
  const groups = new Map<CommentReactionEmoji, CommentReactionSummary>();
  for (const row of rows) {
    if (!allowed.has(row.emoji)) continue;
    const emoji = row.emoji as CommentReactionEmoji;
    const current = groups.get(emoji) ?? { emoji, count: 0, mine: false, names: [] };
    current.count += 1;
    current.mine ||= row.userId === currentUserId;
    current.names.push(row.user.name);
    groups.set(emoji, current);
  }
  return COMMENT_REACTIONS.flatMap((emoji) => {
    const group = groups.get(emoji);
    return group ? [{ ...group, names: [...group.names].sort((a, b) => a.localeCompare(b)) }] : [];
  });
}

// Mentions are stored inline in comment bodies as @[Display Name](user-uuid).
export const MENTION_RE = /@\[([^\]\n]{1,120})\]\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;

export function mentionedUserIds(body: string): string[] {
  return [...new Set([...body.matchAll(MENTION_RE)].map((m) => m[2].toLowerCase()))];
}

export function mentionToken(name: string, id: string) {
  return `@[${name.replace(/[\][\n]/g, "")}](${id})`;
}

/** Plain text for excerpts: "@[Anna](id)" -> "@Anna". */
export function stripMentions(body: string) {
  return body.replace(MENTION_RE, (_m, name: string) => `@${name}`);
}

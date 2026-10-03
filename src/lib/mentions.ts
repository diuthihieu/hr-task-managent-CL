// Mentions are stored inline in comment bodies as @[Display Name](user-uuid).
export const MENTION_RE = /@\[([^\]\n]{1,120})\]\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;

/** Rich comments keep the stable user id in an inline, non-editable mention node. */
export const RICH_MENTION_RE = /<span\b[^>]*\bdata-woli-mention="([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"[^>]*>[\s\S]*?<\/span>/gi;
export const RICH_COMMENT_PREFIX = "<!--woli-rich-comment:v1-->";

export function isRichComment(body: string) {
  return body.startsWith(RICH_COMMENT_PREFIX);
}

export function richCommentHtml(body: string) {
  return isRichComment(body) ? body.slice(RICH_COMMENT_PREFIX.length) : "";
}

export function richMentionHtml(name: string, id: string) {
  const escapedName = name.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
  return `<span data-woli-mention="${id.toLowerCase()}">@${escapedName}</span>`;
}

export function mentionedUserIds(body: string): string[] {
  return [
    ...new Set([
      ...[...body.matchAll(MENTION_RE)].map((m) => m[2].toLowerCase()),
      ...[...body.matchAll(RICH_MENTION_RE)].map((m) => m[1].toLowerCase()),
    ]),
  ];
}

export function mentionToken(name: string, id: string) {
  return `@[${name.replace(/[\][\n]/g, "")}](${id})`;
}

/** Add a reply mention without flattening an in-progress rich-text draft. */
export function prependMention(body: string, name: string, id: string) {
  if (mentionedUserIds(body).includes(id.toLowerCase())) return body;
  if (isRichComment(body)) return `${RICH_COMMENT_PREFIX}<p>${richMentionHtml(name, id)} </p>${richCommentHtml(body)}`;
  return `${mentionToken(name, id)} ${body}`;
}

/** Plain text for excerpts: "@[Anna](id)" -> "@Anna". */
export function stripMentions(body: string) {
  const withPlainMentions = body
    .replace(MENTION_RE, (_m, name: string) => `@${name}`)
    .replace(RICH_MENTION_RE, (node) => node.replace(/^<span\b[^>]*>|<\/span>$/gi, ""));
  if (!isRichComment(withPlainMentions)) return withPlainMentions;
  return withPlainMentions
    .slice(RICH_COMMENT_PREFIX.length)
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|li|blockquote|pre)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:0*39|x0*27);/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

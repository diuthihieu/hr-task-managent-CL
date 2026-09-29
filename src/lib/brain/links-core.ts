// Links written in rich content -> the entities they point to. Pure (no server
// imports): used by the knowledge graph, backlinks, knowledge health and the
// editor. A link is an ordinary <a href="/w/<slug>/..."> - nothing else stores
// relations, so the content stays the single source of truth.

export type EntityType = "wiki" | "task" | "project" | "objective" | "kr" | "person" | "decision" | "file";

export interface ContentLink {
  /** "<type>:<uuid>" */
  target: string;
  type: EntityType;
  id: string;
  /** Block-level link (#b-<blockId>) into a wiki page. */
  blockId?: string;
  /** The link's visible text. */
  text: string;
  href: string;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const RULES: [RegExp, EntityType, (m: RegExpExecArray) => string][] = [
  [new RegExp(`/wiki/${UUID}/(${UUID})`, "i"), "wiki", (m) => m[1]],
  [new RegExp(`/brain/decisions/(${UUID})`, "i"), "decision", (m) => m[1]],
  [new RegExp(`/okrs/${UUID}\\?(?:[^#]*&)?kr=(${UUID})`, "i"), "kr", (m) => m[1]],
  [new RegExp(`/okrs/(${UUID})`, "i"), "objective", (m) => m[1]],
  [new RegExp(`/t/(${UUID})`, "i"), "task", (m) => m[1]],
  [new RegExp(`/p/(${UUID})(?!/t/)`, "i"), "project", (m) => m[1]],
  [new RegExp(`/api/attachments/(${UUID})/`, "i"), "file", (m) => m[1]],
  [new RegExp(`[?&]focus=person:(${UUID})`, "i"), "person", (m) => m[1]],
];
export const BLOCK_ID_RE = /^[a-z0-9]{6,16}$/;

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const stripTags = (s: string) => decode(s.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();

/** The entity an internal href points to (first matching rule wins), or null for external links. */
export function parseHref(rawHref: string): Omit<ContentLink, "text"> | null {
  const href = decode(rawHref);
  if (/^[a-z]+:/i.test(href) && !href.startsWith("/")) {
    // Absolute URL: only our own paths count (copied links keep the origin).
    try {
      const u = new URL(href);
      return parseHref(u.pathname + u.search + u.hash);
    } catch {
      return null;
    }
  }
  if (!href.startsWith("/")) return null;
  for (const [re, type, id] of RULES) {
    const m = re.exec(href);
    if (m) {
      const block = type === "wiki" ? /#b-([a-z0-9]{6,16})/i.exec(href)?.[1] : undefined;
      const uuid = id(m).toLowerCase();
      return { target: `${type}:${uuid}`, type, id: uuid, href, ...(block ? { blockId: block.toLowerCase() } : {}) };
    }
  }
  return null;
}

/** Every internal link in a piece of HTML, in document order (duplicates kept). */
export function parseContentLinks(html: string | null | undefined): ContentLink[] {
  if (!html || !html.includes("href")) return [];
  const out: ContentLink[] = [];
  for (const m of html.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const hit = parseHref(m[1]);
    if (hit) out.push({ ...hit, text: stripTags(m[2]) });
  }
  return out;
}

/** Distinct link targets ("<type>:<uuid>"). */
export function linkedTargets(html: string | null | undefined): string[] {
  return [...new Set(parseContentLinks(html).map((l) => l.target))];
}

/** Block ids present in a page (data-block-id="..."). */
export function blockIdsIn(html: string | null | undefined): Set<string> {
  return new Set([...(html ?? "").matchAll(/data-block-id="([a-z0-9]{6,16})"/gi)].map((m) => m[1].toLowerCase()));
}

/** Plain text of the block (paragraph, heading, list item…) around position `at` - the context of a mention. */
export function blockTextAround(html: string, at: number, max = 240): string {
  let start = Math.max(0, at - 300);
  for (const m of html.matchAll(/<(p|h[1-4]|li|blockquote|td|th)\b[^>]*>/gi)) {
    if (m.index! > at) break;
    start = m.index!;
  }
  const endMatch = /<\/(p|h[1-4]|li|blockquote|td|th)>/i.exec(html.slice(at));
  const end = endMatch ? at + endMatch.index + endMatch[0].length : Math.min(html.length, at + 300);
  const text = stripTags(html.slice(start, end));
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Normalized tag: lower-case, no leading "#", spaces -> "-", max 40 chars. */
export function normalizeTag(raw: string): string {
  return raw.normalize("NFC").trim().replace(/^#+/, "").toLowerCase().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_/-]/gu, "").slice(0, 40);
}

/** Href of an entity inside a workspace (the inverse of parseHref, used by pickers and AI sources). */
export function entityHref(base: string, e: { type: EntityType; id: string; wikiId?: string; projectId?: string; objectiveId?: string; blockId?: string }): string | undefined {
  switch (e.type) {
    case "wiki":
      return e.wikiId ? `${base}/wiki/${e.wikiId}/${e.id}${e.blockId ? `#b-${e.blockId}` : ""}` : undefined;
    case "task":
      return e.projectId ? `${base}/p/${e.projectId}/t/${e.id}` : undefined;
    case "project":
      return `${base}/p/${e.id}`;
    case "objective":
      return `${base}/okrs/${e.id}`;
    case "kr":
      return e.objectiveId ? `${base}/okrs/${e.objectiveId}?kr=${e.id}` : undefined;
    case "decision":
      return `${base}/brain/decisions/${e.id}`;
    case "person":
      return `${base}/wiki/graph?mode=local&focus=person:${e.id}`;
    case "file":
      return `/api/attachments/${e.id}/download?inline=1`;
  }
}

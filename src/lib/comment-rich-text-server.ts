import "server-only";
import sanitizeHtml from "sanitize-html";
import { badRequest } from "./http-errors";
import { isRichComment, RICH_COMMENT_PREFIX, richCommentHtml } from "./mentions";
import { COMMENT_IMAGE_SRC, commentImageUrl } from "./comment-images";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "s", "strike", "code", "pre", "blockquote", "ul", "ol", "li", "a", "span"],
  allowedAttributes: {
    a: ["href", "target", "rel"],
    span: ["data-woli-mention"],
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowProtocolRelative: false,
  transformTags: {
    a: (tagName, attribs): sanitizeHtml.Tag => {
      const href = attribs.href ?? "";
      return { tagName, attribs: /^\/(?!\/)/.test(href) ? { href } : { href, target: "_blank", rel: "noopener noreferrer nofollow" } };
    },
    span: (tagName, attribs): sanitizeHtml.Tag => {
      const id = attribs["data-woli-mention"];
      return { tagName, attribs: id && UUID.test(id) ? { "data-woli-mention": id.toLowerCase() } : {} };
    },
  },
};

/**
 * Sanitizes the HTML emitted by the comment editor. Legacy Markdown/plain-text
 * comments pass through unchanged and continue to render with the old parser.
 * `imageIds`: attachments of this task that may be shown as images (see comment-images.ts); every
 * other <img> is dropped. Without it (e.g. wiki comments) no images are kept.
 */
export function sanitizeCommentBody(body: string, opts: { imageIds?: ReadonlySet<string> } = {}): string {
  if (!isRichComment(body)) return body;
  const allowed = opts.imageIds ?? new Set<string>();
  const clean = sanitizeHtml(richCommentHtml(body), {
    ...OPTIONS,
    allowedTags: [...(OPTIONS.allowedTags as string[]), "img"],
    allowedAttributes: { ...OPTIONS.allowedAttributes, img: ["src", "alt"] },
    allowedSchemesByTag: { img: [] },
    transformTags: {
      ...OPTIONS.transformTags,
      img: (tagName, attribs): sanitizeHtml.Tag => {
        const id = COMMENT_IMAGE_SRC.exec(attribs.src ?? "")?.[1]?.toLowerCase();
        return { tagName, attribs: id && allowed.has(id) ? { src: commentImageUrl(id), alt: (attribs.alt ?? "").slice(0, 200) } : {} };
      },
    },
    exclusiveFilter: (frame) => frame.tag === "img" && !frame.attribs.src,
  }).trim();
  const textOnly = clean.replace(/<br\s*\/?\s*>/gi, "").replace(/<[^>]+>/g, "").replace(/&nbsp;/gi, " ").trim();
  if (!textOnly && !/<img\b/i.test(clean)) throw badRequest("Comment cannot be empty");
  return `${RICH_COMMENT_PREFIX}${clean}`;
}

/** Of the images a comment body references, the ones that are live attachments of this task. */
export async function taskCommentImageIds(taskId: string, body: string): Promise<Set<string>> {
  const { commentImageIds } = await import("./comment-images");
  const wanted = commentImageIds(body);
  if (!wanted.length) return new Set();
  const { prisma } = await import("./prisma");
  const rows = await prisma.attachment.findMany({ where: { id: { in: wanted }, taskId, deletedAt: null }, select: { id: true } });
  return new Set(rows.map((r) => r.id.toLowerCase()));
}

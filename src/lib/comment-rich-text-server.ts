import "server-only";
import sanitizeHtml from "sanitize-html";
import { badRequest } from "./http-errors";
import { isRichComment, RICH_COMMENT_PREFIX, richCommentHtml } from "./mentions";

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
 */
export function sanitizeCommentBody(body: string): string {
  if (!isRichComment(body)) return body;
  const clean = sanitizeHtml(richCommentHtml(body), OPTIONS).trim();
  const textOnly = clean.replace(/<br\s*\/?\s*>/gi, "").replace(/<[^>]+>/g, "").replace(/&nbsp;/gi, " ").trim();
  if (!textOnly) throw badRequest("Comment cannot be empty");
  return `${RICH_COMMENT_PREFIX}${clean}`;
}

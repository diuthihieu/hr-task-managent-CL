// Server-side sanitizer for rich page content (record pages, wiki pages).
// The editor produces HTML; nothing from the client is stored or rendered
// until it has passed this allow-list, so a crafted request cannot inject
// scripts, event handlers, iframes or external tracking pixels.

import sanitizeHtml from "sanitize-html";
import { badRequest } from "./http-errors";

export const MAX_RICH_TEXT_CHARS = 400_000;

// Images may only point at our own authorized attachment route.
const IMG_SRC = /^\/api\/attachments\/[0-9a-f-]{36}\/download\?inline=1$/i;

// Block ids (data-block-id) make block-level links possible (#b-<id>).
const BLOCK_ID = /^[a-z0-9]{6,16}$/;
const BLOCK_TAGS = ["p", "h1", "h2", "h3", "h4", "li", "blockquote", "pre"];
const keepBlockId: sanitizeHtml.Transformer = (tagName, attribs) => {
  const { ["data-block-id"]: id, ...rest } = attribs;
  return { tagName, attribs: id && BLOCK_ID.test(id) ? { ...rest, "data-block-id": id } : rest };
};

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "hr", "h1", "h2", "h3", "h4", "strong", "b", "em", "i", "u", "s", "strike", "code", "pre", "blockquote", "mark",
    "ul", "ol", "li", "a", "img", "table", "thead", "tbody", "tr", "th", "td", "colgroup", "col", "label", "input", "div", "span",
  ],
  allowedAttributes: {
    a: ["href", "target", "rel"],
    img: ["src", "alt", "title", "width", "height"],
    ul: ["data-type"],
    li: ["data-type", "data-checked", "data-block-id"],
    p: ["data-block-id"],
    h1: ["data-block-id"],
    h2: ["data-block-id"],
    h3: ["data-block-id"],
    h4: ["data-block-id"],
    blockquote: ["data-block-id"],
    input: ["type", "checked", "disabled"],
    th: ["colspan", "rowspan", "colwidth"],
    td: ["colspan", "rowspan", "colwidth"],
    col: ["style"],
    pre: ["class", "data-block-id"],
    code: ["class"],
    mark: ["data-color"],
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowedSchemesByTag: { img: ["https"] },
  allowProtocolRelative: false,
  allowedStyles: { col: { "min-width": [/^\d+px$/], width: [/^\d+px$/] } },
  exclusiveFilter: (frame) => frame.tag === "img" && !IMG_SRC.test(frame.attribs.src ?? ""),
  transformTags: {
    ...Object.fromEntries(BLOCK_TAGS.map((t) => [t, keepBlockId])),
    // Internal links (/w/...) open in the app; external ones in a new tab.
    a: (tagName, attribs): sanitizeHtml.Tag => {
      const href = attribs.href ?? "";
      return { tagName, attribs: /^\/(?!\/)/.test(href) ? { href } : { ...attribs, target: "_blank", rel: "noopener noreferrer nofollow" } };
    },
    input: (tagName, attribs) => ({ tagName, attribs: attribs.type === "checkbox" ? { type: "checkbox", ...(attribs.checked !== undefined ? { checked: "checked" } : {}) } : {} }),
  },
};

/** Returns sanitized HTML, or null for empty content. */
export function sanitizeRichText(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== "string") throw badRequest("Content must be HTML text");
  if (input.length > MAX_RICH_TEXT_CHARS) throw badRequest("Content is too long");
  const clean = sanitizeHtml(input, OPTIONS).trim();
  const textOnly = clean.replace(/<(?!img)[^>]*>/g, "").trim();
  return textOnly ? clean : null;
}

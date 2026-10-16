"use client";
import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { cn } from "@/lib/utils";
import { repairTables } from "@/lib/markdown-tables";

marked.setOptions({ gfm: true, breaks: true });

// Links in AI answers (source citations to tasks) open in a new tab, so the
// conversation stays where it is while the user checks the source.
let hooked = false;
function hookLinks() {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A" && node.getAttribute("href")) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
}

/** Markdown → sanitized HTML (AI output is untrusted text). */
export function markdownToHtml(md: string): string {
  const html = marked.parse(repairTables(md), { async: false }) as string;
  if (typeof window === "undefined") return "";
  hookLinks();
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ["style", "form", "input", "button", "iframe"], FORBID_ATTR: ["style"] });
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => markdownToHtml(text), [text]);
  return <div className={cn("ai-md", className)} dangerouslySetInnerHTML={{ __html: html }} />;
}

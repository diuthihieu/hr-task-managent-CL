"use client";
import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { cn } from "@/lib/utils";

marked.setOptions({ gfm: true, breaks: true });

/** Markdown → sanitized HTML (AI output is untrusted text). */
export function markdownToHtml(md: string): string {
  const html = marked.parse(md, { async: false }) as string;
  if (typeof window === "undefined") return "";
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ["style", "form", "input", "button", "iframe"], FORBID_ATTR: ["style"] });
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => markdownToHtml(text), [text]);
  return <div className={cn("ai-md", className)} dangerouslySetInnerHTML={{ __html: html }} />;
}

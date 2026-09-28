import "server-only";
import { HttpError } from "../http-errors";
import { generate } from "./gemini";

export const MAX_DOC_BYTES = 4 * 1024 * 1024; // Vercel request body limit is 4.5 MB.
export const MAX_DOC_CHARS = 300_000;

const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|log)$/i;
const HTML_EXT = /\.html?$/i;
const DOCX_EXT = /\.docx$/i;
const SHEET_EXT = /\.(xlsx|xls)$/i;
const PDF_EXT = /\.pdf$/i;
const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

export const SUPPORTED_DOC_HINT = "PDF, Word (.docx), Excel (.xlsx), TXT, Markdown, CSV, JSON, HTML, PNG/JPG";

/** Strip HTML to readable text (keeps line breaks between blocks). */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr|\/blockquote|\/pre)[^>]*>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function transcribeWithGemini(buf: Buffer, mimeType: string) {
  const r = await generate({
    system: "You convert documents to plain text. Output only the document's text content, preserving headings, lists and tables (as Markdown). Do not summarize, translate or add commentary.",
    contents: [{ role: "user", parts: [{ inlineData: { mimeType, data: buf.toString("base64") } }, { text: "Transcribe the full text of this document." }] }],
    temperature: 0,
    maxOutputTokens: 32768,
  });
  return r.text;
}

/** Extract the text of an uploaded reference document. */
export async function extractDocText(file: File): Promise<string> {
  if (!file.size) throw new HttpError(400, "File is empty");
  if (file.size > MAX_DOC_BYTES) throw new HttpError(413, "File is too large (max 4 MB) - split it or upload the key sections");
  const name = file.name;
  const buf = Buffer.from(await file.arrayBuffer());
  let text: string;
  if (TEXT_EXT.test(name)) text = buf.toString("utf8");
  else if (HTML_EXT.test(name)) text = htmlToText(buf.toString("utf8"));
  else if (DOCX_EXT.test(name)) {
    const mammoth = await import("mammoth");
    text = (await mammoth.extractRawText({ buffer: buf })).value;
  } else if (SHEET_EXT.test(name)) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(buf, { type: "buffer" });
    text = wb.SheetNames.map((s) => `## ${s}\n${XLSX.utils.sheet_to_csv(wb.Sheets[s])}`).join("\n\n");
  } else if (PDF_EXT.test(name)) text = await transcribeWithGemini(buf, "application/pdf");
  else {
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    if (!IMAGE_TYPES[ext]) throw new HttpError(400, `Unsupported file type. Use: ${SUPPORTED_DOC_HINT}`);
    text = await transcribeWithGemini(buf, IMAGE_TYPES[ext]);
  }
  text = text.replace(/\u0000/g, "").trim();
  if (!text) throw new HttpError(400, "No readable text found in this file");
  return text.length > MAX_DOC_CHARS ? text.slice(0, MAX_DOC_CHARS) : text;
}

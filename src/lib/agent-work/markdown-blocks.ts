// Markdown of an Agent result as blocks the file writers understand: headings, list items, paragraphs
// and tables (as cells, not as "| a | b |" text). Pure, unit-tested.

export type MdBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "table"; header: string[]; rows: string[][] }
  | { kind: "space" };

/** Inline Markdown marks removed: **bold**, *italic*, `code`, [text](url) -> text (url). */
export function plainInline(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => (label === url ? url : `${label} (${url})`))
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[\s(])[*_](\S(?:[^*_\n]*\S)?)[*_](?=$|[\s).,;:!?])/g, "$1$2")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/<br\s*\/?>/gi, " ")
    .trim();
}

const isRow = (line: string) => line.startsWith("|") || (line.includes("|") && !/^[-*#>\d]/.test(line));
const isSeparator = (line: string) => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(line) && line.includes("-");

function cells(line: string): string[] {
  const inner = line.replace(/^\|/, "").replace(/\|\s*$/, "");
  return inner.split(/(?<!\\)\|/).map((c) => plainInline(c.replace(/\\\|/g, "|")));
}

export function markdownBlocks(markdown: string): MdBlock[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n").map((l) => l.trim());
  const out: MdBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) {
      if (out.length && out[out.length - 1].kind !== "space") out.push({ kind: "space" });
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) continue; // horizontal rule
    if (isRow(line) && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      const header = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i] && lines[i].includes("|") && !isSeparator(lines[i])) {
        const row = cells(lines[i]);
        // Every row as wide as the header: short rows are padded, extra cells joined into the last one.
        if (row.length > header.length) row.splice(header.length - 1, row.length - header.length + 1, row.slice(header.length - 1).join(" | "));
        while (row.length < header.length) row.push("");
        rows.push(row);
        i++;
      }
      i--;
      out.push({ kind: "table", header, rows });
      continue;
    }
    if (isSeparator(line) && line.includes("|")) continue; // a stray separator row
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      out.push({ kind: "heading", level: Math.min(3, heading[1].length), text: plainInline(heading[2]) });
      continue;
    }
    const bullet = /^(?:[-*+]|\d+[.)])\s+(.+)$/.exec(line);
    if (bullet) {
      out.push({ kind: "bullet", text: plainInline(bullet[1]) });
      continue;
    }
    out.push({ kind: "paragraph", text: plainInline(line.replace(/^>\s?/, "")) });
  }
  while (out.length && out[out.length - 1].kind === "space") out.pop();
  return out;
}

/** "45.8" -> 45.8, "1,250" -> 1250, "59.61%" -> { percent: 0.5961 }; anything else stays text. */
export function cellValue(text: string): string | number | { percent: number } {
  const t = text.trim();
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return Number(t.replace(/,/g, ""));
  if (/^-?\d+(\.\d+)?$/.test(t) && t.length <= 15 && !/^0\d/.test(t)) return Number(t);
  const pct = /^(-?\d+(?:\.\d+)?)\s*%$/.exec(t);
  if (pct) return { percent: Math.round(Number(pct[1]) * 1e6) / 1e8 };
  return text;
}

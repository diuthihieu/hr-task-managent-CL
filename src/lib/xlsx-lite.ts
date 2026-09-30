// Minimal, dependency-light .xlsx reader (sheet names + cell text) for text
// extraction and previews of files uploaded by other people. It only reads
// shared strings and cell values - no formulas, styles or macros - with
// bounded, linear regexes and a size-checked archive (see zip-guard). Used
// instead of the old SheetJS npm build (CVE-2023-30533, CVE-2024-22363).
import JSZip from "jszip";
import { assertSafeZip } from "./zip-guard";

const MAX_ROWS = 20_000;
const MAX_COLS = 200;

const decode = (x: string) =>
  x.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(Number(n), 0x10ffff))).replace(/&amp;/g, "&");
const texts = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((m) => decode(m[1])).join("");
const colIndex = (ref: string) => {
  let n = 0;
  for (const ch of ref.replace(/[0-9]/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

export interface SheetData {
  name: string;
  rows: string[][];
}

export async function readXlsx(buf: Uint8Array): Promise<SheetData[]> {
  assertSafeZip(buf);
  const zip = await JSZip.loadAsync(buf);
  const read = async (path: string) => (await zip.file(path)?.async("string")) ?? "";
  const [workbook, rels, shared] = await Promise.all([read("xl/workbook.xml"), read("xl/_rels/workbook.xml.rels"), read("xl/sharedStrings.xml")]);
  if (!workbook) throw new Error("Not an .xlsx workbook");
  const strings = [...shared.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));
  const targets = new Map([...rels.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g)].map((m) => [m[1], m[2]]));
  const sheets = [...workbook.matchAll(/<sheet\b[^>]*\bname="([^"]*)"[^>]*\br:id="([^"]+)"/g)].map((m) => ({ name: decode(m[1]), target: targets.get(m[2]) ?? "" }));
  const out: SheetData[] = [];
  for (const sh of sheets) {
    const path = sh.target.startsWith("/") ? sh.target.slice(1) : `xl/${sh.target.replace(/^\.?\//, "")}`;
    const xml = await read(path);
    const rows: string[][] = [];
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      if (rows.length >= MAX_ROWS) break;
      const cells: string[] = [];
      for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
        const idx = ref ? colIndex(ref) : cells.length;
        if (idx >= MAX_COLS) continue;
        const type = /\bt="([a-zA-Z]+)"/.exec(attrs)?.[1];
        const body = c[2] ?? "";
        const v = /<v>([^<]*)<\/v>/.exec(body)?.[1];
        let value = "";
        if (type === "s") value = strings[Number(v)] ?? "";
        else if (type === "inlineStr") value = texts(body);
        else if (type === "b") value = v === "1" ? "TRUE" : "FALSE";
        else value = v !== undefined ? decode(v) : "";
        while (cells.length < idx) cells.push("");
        cells[idx] = value;
      }
      rows.push(cells);
    }
    out.push({ name: sh.name, rows });
  }
  return out;
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export const sheetToCsv = (rows: string[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\n");

/** RFC-4180-ish CSV / TSV parser (quotes, escaped quotes, newlines in quotes); linear time. */
export function parseCsv(text: string, maxRows = MAX_ROWS): string[][] {
  const sep = text.split("\n", 1)[0].includes("\t") && !text.split("\n", 1)[0].includes(",") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length && rows.length < maxRows; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && !cell) quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}

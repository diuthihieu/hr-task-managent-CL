/**
 * Repairs Markdown tables that lost their header. When an AI answer is cut off
 * and the user asks it to continue, the next message often starts in the middle
 * of a table: plain "| a | b |" rows with no header and no "|---|" line, which
 * Markdown shows as text full of pipes. Such rows get an empty header (hidden by
 * CSS) so they render as a table again. A first line that ends with "|" right
 * before those rows (the tail of a cut row) joins the table too.
 */

const isRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isSeparator = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const cells = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).length;

export function repairTables(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence || !(isRow(line) || (/\|\s*$/.test(line) && line.includes("|") && isRow(lines[i + 1] ?? "")))) {
      out.push(line);
      continue;
    }
    // A run of table lines starts here.
    let j = i;
    const run: string[] = [];
    while (j < lines.length && (j === i || isRow(lines[j]) || isSeparator(lines[j]))) run.push(lines[j++]);
    const hasHeader = run.length >= 2 && isRow(run[0]) && isSeparator(run[1]);
    if (hasHeader) {
      out.push(...run);
    } else {
      const rows = run.filter((l) => !isSeparator(l)).map((l) => (isRow(l) ? l : `| ${l.trim()}`));
      const n = Math.max(...rows.map(cells));
      if (out.length && out[out.length - 1].trim() !== "") out.push("");
      out.push(`|${" |".repeat(n)}`, `|${" --- |".repeat(n)}`, ...rows);
    }
    i = j - 1;
  }
  return out.join("\n");
}

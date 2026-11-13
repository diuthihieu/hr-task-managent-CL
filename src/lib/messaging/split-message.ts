// Pure, unit-tested.

/**
 * A long Markdown text as one or more messages, none longer than `max`, with nothing left out. Parts end
 * between blocks (blank lines). A block too long for one message is divided between its lines; when that
 * block is a table, every part of it starts with the table's header, so each part still renders as a table.
 * Only a single line longer than `max` is divided inside.
 */
export function splitMessage(text: string, max: number): string[] {
  const whole = text.trim();
  if (whole.length <= max) return [whole];
  const pieces = whole.split(/\n{2,}/).flatMap((block) => divideBlock(block, max));
  const parts: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (!current) current = piece;
    else if (current.length + 2 + piece.length <= max) current += `\n\n${piece}`;
    else {
      parts.push(current);
      current = piece;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function divideBlock(block: string, max: number): string[] {
  if (block.length <= max) return [block];
  const lines = block.split("\n");
  const table = lines.length > 2 && /^\s*\|/.test(lines[0]) && /^\s*\|?\s*:?-{3,}/.test(lines[1]);
  const head = table ? `${lines[0]}\n${lines[1]}\n` : "";
  // A header that leaves no room for rows is treated as plain lines.
  const prefix = head.length < max / 2 ? head : "";
  const room = max - prefix.length;
  const rows = (prefix ? lines.slice(2) : lines).flatMap((line) => {
    const out: string[] = [];
    for (let i = 0; i < line.length || i === 0; i += room) out.push(line.slice(i, i + room));
    return out;
  });
  const out: string[] = [];
  let current = "";
  for (const row of rows) {
    if (current && current.length + 1 + row.length > room) {
      out.push(prefix + current);
      current = row;
    } else current = current ? `${current}\n${row}` : row;
  }
  if (current) out.push(prefix + current);
  return out;
}

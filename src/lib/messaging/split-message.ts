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

const SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
/** The "---|---" row under a table's header (with or without the outer pipes). */
function isSeparator(line: string | undefined): boolean {
  return !!line && line.includes("|") && line.includes("-") && SEPARATOR.test(line);
}

function divideBlock(block: string, max: number): string[] {
  if (block.length <= max) return [block];
  const lines = block.split("\n");
  const out: string[] = [];
  let current = "";
  // The header of the table the walk is inside (it may start anywhere in the block, e.g. under a heading).
  let head = "";
  const push = () => {
    if (current) out.push(current);
    current = "";
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes("|") && isSeparator(lines[i + 1])) {
      const header = `${line}\n${lines[i + 1]}`;
      // A header too long to repeat is treated as plain lines.
      head = header.length < max / 2 ? header : "";
      if (head) {
        if (current && current.length + 1 + head.length > max) push();
        current = current ? `${current}\n${head}` : head;
        i++;
        continue;
      }
    } else if (head && !line.includes("|")) head = ""; // the table ended
    const room = max - (head ? head.length + 1 : 0);
    for (let at = 0; at < line.length || at === 0; at += room) {
      const piece = line.slice(at, at + room);
      if (current && current.length + 1 + piece.length > max) {
        push();
        current = head ? `${head}\n${piece}` : piece;
      } else current = current ? `${current}\n${piece}` : piece;
    }
  }
  push();
  return out;
}

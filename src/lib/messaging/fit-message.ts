// Pure, unit-tested.

/**
 * A long Markdown text cut to fit one message. It ends at the end of a block (a blank line) when one is
 * near enough, else at the end of a line - so a list item or a table row is never cut in the middle and
 * what is kept still renders. Only a single line longer than the limit is cut inside.
 */
export function fitMessage(text: string, max: number): string {
  if (text.length <= max) return text;
  const room = max - 2;
  const block = text.lastIndexOf("\n\n", room);
  const line = text.lastIndexOf("\n", room);
  const cut = block > max / 2 ? block : line > 0 ? line : room;
  return `${text.slice(0, cut).trimEnd()}\n…`;
}

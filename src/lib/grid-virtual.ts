// BUG-06a: helpers for the virtualized task table (kept free of React so they can be unit tested).

/** The window's indexes plus rows that must stay rendered (being dragged / holding focus), sorted. */
export function keepIndexes(window: number[], keep: number[]): number[] {
  const extra = keep.filter((i) => i >= 0 && !window.includes(i));
  return extra.length ? [...new Set([...window, ...extra])].sort((a, b) => a - b) : window;
}

/**
 * Spacer heights for the rendered rows: `before[i]` is the empty space above item i (the rows between
 * it and the previous rendered item, or above the first), `after` the space below the last. Item
 * offsets include `margin` (the header above the rows).
 */
export function virtualSpacers(items: { start: number; end: number }[], total: number, margin: number): { before: number[]; after: number } {
  let edge = margin;
  const before = items.map((item) => {
    const gap = Math.max(0, item.start - edge);
    edge = item.end;
    return gap;
  });
  return { before, after: items.length ? Math.max(0, total - (edge - margin)) : 0 };
}

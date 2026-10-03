export const GANTT_TASK_COLUMN_DEFAULT_WIDTH = 240;
export const GANTT_TASK_COLUMN_MIN_WIDTH = 180;
export const GANTT_TASK_COLUMN_MAX_WIDTH = 520;

export function clampGanttTaskColumnWidth(width: number) {
  if (!Number.isFinite(width)) return GANTT_TASK_COLUMN_DEFAULT_WIDTH;
  return Math.min(GANTT_TASK_COLUMN_MAX_WIDTH, Math.max(GANTT_TASK_COLUMN_MIN_WIDTH, Math.round(width)));
}

/**
 * Estimate a readable task-column width without touching browser-only APIs so
 * the Client Component produces the same initial markup during SSR/hydration.
 */
export function fitGanttTaskColumnWidth(names: string[]) {
  const longest = names.reduce((max, name) => Math.max(max, estimateTextWidth(name)), 0);
  // Room for the expand action, cell padding and the resize handle.
  return clampGanttTaskColumnWidth(longest + 56);
}

function estimateTextWidth(value: string) {
  return Array.from(value).reduce((width, character) => {
    if (/\s/u.test(character)) return width + 4;
    if (/[ilI1|.,'`]/u.test(character)) return width + 4.5;
    if (/[MW@#%&]/u.test(character)) return width + 10;
    if (character.codePointAt(0)! > 127) return width + 8.5;
    return width + 7.25;
  }, 0);
}

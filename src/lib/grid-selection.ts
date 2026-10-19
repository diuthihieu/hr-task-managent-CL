/** Rectangular cell selection and paste / fill-down planning for the task grid (pure, index based). */

export interface CellPos {
  row: number;
  col: number;
}

export interface CellRange {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export function normalizeRange(a: CellPos, b: CellPos): CellRange {
  return { top: Math.min(a.row, b.row), bottom: Math.max(a.row, b.row), left: Math.min(a.col, b.col), right: Math.max(a.col, b.col) };
}

export const rangeRows = (range: CellRange) => range.bottom - range.top + 1;
export const rangeCols = (range: CellRange) => range.right - range.left + 1;
export const inRange = (range: CellRange, row: number, col: number) => row >= range.top && row <= range.bottom && col >= range.left && col <= range.right;

/** One cell write: target position (row may be >= rowCount, meaning a new row) and the source cell it takes. */
export interface PlannedCell {
  row: number;
  col: number;
  srcRow: number;
  srcCol: number;
}

/**
 * Spreadsheet paste rules:
 * - a single copied cell fills every selected cell;
 * - a block pasted into a selection that is an exact multiple of its size is repeated to fill it;
 * - otherwise the block is pasted once from the top-left selected cell. Columns past the last one are
 *   dropped; rows past the last one are returned with `row >= rowCount` so the caller can add rows.
 */
export function planPaste(src: { rows: number; cols: number }, target: CellRange, grid: { rows: number; cols: number }): PlannedCell[] {
  if (src.rows < 1 || src.cols < 1) return [];
  const tRows = rangeRows(target);
  const tCols = rangeCols(target);
  const tile = (src.rows === 1 && src.cols === 1) || (tRows % src.rows === 0 && tCols % src.cols === 0 && (tRows > src.rows || tCols > src.cols));
  const rows = tile ? tRows : src.rows;
  const cols = tile ? tCols : src.cols;
  const out: PlannedCell[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const col = target.left + c;
      if (col >= grid.cols) continue;
      out.push({ row: target.top + r, col, srcRow: r % src.rows, srcCol: c % src.cols });
    }
  }
  return out;
}

/**
 * Ctrl+D: the top row of the selection is copied into the rows below it. With a single selected row,
 * the row above it is copied down instead (as in Excel). Returns null when there is nothing to copy from.
 */
export function planFillDown(range: CellRange): { sourceRow: number; rows: number[] } | null {
  if (range.top === range.bottom) return range.top > 0 ? { sourceRow: range.top - 1, rows: [range.top] } : null;
  const rows: number[] = [];
  for (let r = range.top + 1; r <= range.bottom; r++) rows.push(r);
  return { sourceRow: range.top, rows };
}

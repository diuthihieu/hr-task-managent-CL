// Summary table (pivot) as rows of cells, for CSV / Excel export: header row, one row per group, totals.
import type { PivotTable } from "./dashboard-engine";

export function pivotMatrix(p: PivotTable, totalLabel = "Total"): (string | number)[][] {
  const head = [p.colField ? `${p.rowField} / ${p.colField}` : p.rowField, ...p.cols.map((c) => c.label), ...(p.colField ? [totalLabel] : [])];
  const body = p.rows.map((r, i) => [r.label, ...p.cells[i], ...(p.colField ? [p.rowTotals[i]] : [])]);
  const foot = [totalLabel, ...p.colTotals, ...(p.colField ? [p.total] : [])];
  return [head, ...body, foot];
}

/** RFC 4180 CSV with a BOM so Excel opens Vietnamese text correctly. */
export function toCsv(rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    const s = String(v);
    // Cells starting with = + - @ are prefixed so a spreadsheet doesn't run them as formulas.
    const safe = typeof v === "string" && /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
}

/**
 * Download file name from a widget title, ASCII only: browsers drop a non-ASCII `download`
 * name and save the file as "download" with no extension (Chromium does). "Giờ làm việc" -> "Gio lam viec".
 */
export function exportFileName(title: string): string {
  const ascii = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return ascii || "summary";
}

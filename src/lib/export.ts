// Client-side CSV/XLSX export for a table/view. Builds one shared matrix of
// cell values from the exact fields + records the caller passes in - the
// caller decides scope (all/filtered/selected records, all/visible fields)
// so this module never re-fetches or duplicates data, it only formats what
// it's given the same way the Grid displays it.

import { getCellValue } from "./query-engine";
import { formatDisplayValue, type FormatMember } from "./format";
import type { FieldRow, RecordRow } from "@/types";

const NUMERIC_TYPES = ["number", "integer", "percent", "currency", "progress", "rating", "duration"];

export interface ExportMatrix {
  headers: string[];
  rows: (string | number)[][];
}

export function buildExportMatrix(fields: FieldRow[], records: RecordRow[], members: FormatMember[] = []): ExportMatrix {
  const headers = fields.map((f) => f.name);
  const rows = records.map((record) =>
    fields.map((field) => {
      const raw = getCellValue(record, field, fields);
      if (NUMERIC_TYPES.includes(field.type) && typeof raw === "number" && !["currency", "percent"].includes(field.type)) {
        return raw;
      }
      return formatDisplayValue(field, raw, members);
    })
  );
  return { headers, rows };
}

function csvEscape(value: string | number): string {
  const str = String(value ?? "");
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function toCsvString({ headers, rows }: ExportMatrix): string {
  const lines = [headers.map(csvEscape).join(","), ...rows.map((row) => row.map(csvEscape).join(","))];
  return lines.join("\r\n");
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadCsv(matrix: ExportMatrix, filename: string) {
  const csv = toCsvString(matrix);
  triggerDownload(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" }), filename.endsWith(".csv") ? filename : `${filename}.csv`);
}

export async function downloadXlsx(matrix: ExportMatrix, filename: string) {
  const XLSX = await import("xlsx");
  const worksheet = XLSX.utils.aoa_to_sheet([matrix.headers, ...matrix.rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Export");
  XLSX.writeFile(workbook, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}

"use client";
import { Fragment, useMemo, useState } from "react";
import { ChevronRight, ChevronDown, Layers } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/misc";
import { exportFileName, toCsv } from "@/lib/pivot-export";
import { matrixRowsForExport, type MatrixNode, type MatrixTable } from "@/lib/pivot-matrix";
import type { WidgetStyleConfig } from "@/lib/dashboard-engine";
import { useT } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";

export type PivotLevels = { rows: string[]; cols: string[] };

const num = (n: number) => (Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 }));

/** Paths of every row that has children (for Expand all). */
function parentPaths(nodes: MatrixNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.children) {
      out.push(n.path);
      parentPaths(n.children, out);
    }
  }
  return out;
}

/**
 * D4: the summary table as a Power BI-like matrix - rows nested by several fields with +/- to drill
 * down, nested column headers with a subtotal per group, Expand / Collapse all, the levels the viewer
 * shows or hides, and CSV / Excel of exactly what is shown.
 */
export function PivotMatrixView({
  matrix,
  title,
  valueLabel,
  style,
  levels,
  onLevels,
}: {
  matrix: MatrixTable;
  title: string;
  valueLabel: string;
  style?: WidgetStyleConfig;
  levels: PivotLevels | null;
  onLevels: (levels: PivotLevels | null) => void;
}) {
  const { t } = useT();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const parents = useMemo(() => parentPaths(matrix.rows), [matrix.rows]);
  const hasCols = matrix.colFields.length > 0;
  const columns = hasCols ? matrix.columns : [];
  const headRows = Math.max(1, matrix.colFields.length);
  const totalLabel = t("db.pivot.total");

  const toggle = (path: string) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const download = (blob: Blob, ext: string) => {
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: `${exportFileName(title)}.${ext}` });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };
  const shown = () => matrixRowsForExport(matrix, new Set(parents.filter((p) => !expanded.has(p))), totalLabel);
  async function xlsx() {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(shown()), "Summary");
    download(new Blob([XLSX.write(wb, { type: "array", bookType: "xlsx" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "xlsx");
  }

  // Header rows: a column group spans its children; a group's subtotal spans the rows below its level.
  const header: { label: string; colSpan: number; rowSpan: number; subtotal?: boolean }[][] = Array.from({ length: headRows }, () => []);
  if (hasCols) {
    for (let r = 0; r < headRows; r++) {
      for (let i = 0; i < columns.length; ) {
        const c = columns[i];
        if (c.subtotal && c.labels.length === r + 1) {
          header[r].push({ label: `${c.labels[r]} · ${totalLabel}`, colSpan: 1, rowSpan: headRows - r, subtotal: true });
          i++;
          continue;
        }
        if (c.labels.length <= r) {
          i++;
          continue;
        }
        const prefix = c.labels.slice(0, r + 1).join("\u0001");
        let span = 0;
        while (i + span < columns.length) {
          const d = columns[i + span];
          if (d.labels.length <= r || d.labels.slice(0, r + 1).join("\u0001") !== prefix || (d.subtotal && d.labels.length === r + 1)) break;
          span++;
        }
        header[r].push({ label: c.labels[r], colSpan: span, rowSpan: 1 });
        i += span;
      }
    }
  }

  const cellCls = "px-2 py-1 border-b border-neutral-100 dark:border-neutral-900 whitespace-nowrap text-right tabular-nums";
  const rows: React.ReactNode[] = [];
  const walk = (nodes: MatrixNode[]) => {
    for (const n of nodes) {
      const open = expanded.has(n.path);
      rows.push(
        <tr key={n.path} className={cn(n.children && "font-medium", n.depth > 0 && "text-neutral-600 dark:text-neutral-300")} data-testid="pivot-row" data-depth={n.depth} data-label={n.label}>
          <td className="px-2 py-1 border-b border-neutral-100 dark:border-neutral-900 whitespace-nowrap text-left" style={{ paddingLeft: 8 + n.depth * 16 }}>
            {n.children ? (
              <button type="button" onClick={() => toggle(n.path)} className="inline-flex items-center gap-1 hover:text-indigo-600" aria-expanded={open} data-testid="pivot-toggle">
                {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {n.label}
              </button>
            ) : (
              <span className={cn(parents.length > 0 && "pl-4")}>{n.label}</span>
            )}
          </td>
          {columns.map((c, j) => (
            <td key={j} className={cn(cellCls, c.subtotal && "bg-neutral-50/70 dark:bg-neutral-800/40")}>
              {num(n.values[j])}
            </td>
          ))}
          <td className={cn(cellCls, "font-medium")}>{num(n.total)}</td>
        </tr>,
      );
      if (n.children && open) walk(n.children);
    }
  };
  walk(matrix.rows);

  const shownRows = levels?.rows ?? matrix.available.rows.map((f) => f.id);
  const shownCols = levels?.cols ?? matrix.available.cols.map((f) => f.id);
  const setLevel = (kind: "rows" | "cols", id: string, on: boolean) => {
    const cur = { rows: shownRows, cols: shownCols };
    const order = (kind === "rows" ? matrix.available.rows : matrix.available.cols).map((f) => f.id);
    const next = on ? order.filter((x) => x === id || cur[kind].includes(x)) : cur[kind].filter((x) => x !== id);
    if (kind === "rows" && !next.length) return; // at least one row level
    const all = { ...cur, [kind]: next };
    const isAll = all.rows.length === matrix.available.rows.length && all.cols.length === matrix.available.cols.length;
    onLevels(isAll ? null : all);
    setExpanded(new Set());
  };
  const btn = "rounded border border-neutral-200 px-2 py-0.5 text-[11px] text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800";

  return (
    <div className="h-full flex flex-col" data-testid="pivot-table">
      <div className="flex flex-wrap items-center justify-end gap-1 pb-1">
        {parents.length > 0 && (
          <>
            <button type="button" className={btn} onClick={() => setExpanded(new Set(parents))} data-testid="pivot-expand-all">
              {t("db.pivot.expandAll")}
            </button>
            <button type="button" className={btn} onClick={() => setExpanded(new Set())} data-testid="pivot-collapse-all">
              {t("db.pivot.collapseAll")}
            </button>
          </>
        )}
        {matrix.available.rows.length + matrix.available.cols.length > 1 && (
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className={cn(btn, "inline-flex items-center gap-1", levels && "border-indigo-300 text-indigo-700 dark:text-indigo-300")} data-testid="pivot-levels">
                <Layers size={11} /> {t("db.pivot.levels")}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-60 p-3 space-y-2" align="end">
              {(["rows", "cols"] as const).map((kind) =>
                matrix.available[kind].length ? (
                  <div key={kind}>
                    <p className="text-[11px] font-medium text-neutral-500 mb-1">{kind === "rows" ? t("db.w.pivotRows") : t("db.w.pivotCols")}</p>
                    {matrix.available[kind].map((f) => {
                      const on = (kind === "rows" ? shownRows : shownCols).includes(f.id);
                      return (
                        <label key={f.id} className="flex items-center gap-2 py-0.5 text-xs cursor-pointer" data-testid="pivot-level" data-field={f.name}>
                          <Checkbox checked={on} onCheckedChange={(v) => setLevel(kind, f.id, v)} /> {f.name}
                        </label>
                      );
                    })}
                  </div>
                ) : null,
              )}
            </PopoverContent>
          </Popover>
        )}
        <button type="button" onClick={() => download(new Blob([toCsv(shown())], { type: "text/csv;charset=utf-8" }), "csv")} className={btn} data-testid="pivot-csv">
          {t("db.pivot.csv")}
        </button>
        <button type="button" onClick={() => void xlsx()} className={btn} data-testid="pivot-xlsx">
          {t("db.pivot.xlsx")}
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto thin-scroll">
        {!matrix.rows.length ? (
          <div className="h-full flex items-center justify-center text-xs text-neutral-400">{t("db.pivot.empty")}</div>
        ) : (
          <table className="w-full text-xs border-collapse" style={{ color: style?.textColor }}>
            <thead className="sticky top-0 bg-white dark:bg-neutral-900" style={{ backgroundColor: style?.backgroundColor }}>
              {header.map((cells, r) => (
                <tr key={r}>
                  {r === 0 && (
                    <th rowSpan={headRows} className="font-medium text-neutral-500 border-b border-neutral-200 dark:border-neutral-800 px-2 py-1 text-left align-bottom">
                      {matrix.rowFields.join(" › ")}
                    </th>
                  )}
                  {cells.map((h, i) => (
                    <th key={i} colSpan={h.colSpan} rowSpan={h.rowSpan} className={cn("font-medium text-neutral-500 border-b border-neutral-200 dark:border-neutral-800 px-2 py-1 text-right", h.colSpan > 1 && "text-center")}>
                      {h.label}
                    </th>
                  ))}
                  {r === 0 && (
                    <th rowSpan={headRows} className="font-medium text-neutral-500 border-b border-neutral-200 dark:border-neutral-800 px-2 py-1 text-right align-bottom">
                      {hasCols ? totalLabel : valueLabel}
                    </th>
                  )}
                </tr>
              ))}
            </thead>
            <tbody>
              <Fragment>{rows}</Fragment>
            </tbody>
            <tfoot>
              <tr className="font-semibold bg-neutral-50 dark:bg-neutral-800/50">
                <td className="px-2 py-1 text-left">{totalLabel}</td>
                {columns.map((_, j) => (
                  <td key={j} className={cellCls}>
                    {num(matrix.totals[j])}
                  </td>
                ))}
                <td className={cellCls}>{num(matrix.total)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}

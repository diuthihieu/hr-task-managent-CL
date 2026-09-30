"use client";
import { useEffect, useState } from "react";
import { MoreHorizontal, Pencil, Trash2, GripVertical } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api-client";
import { ChartRenderer, CHART_COLORS } from "./chart-renderer";
import { AGGREGATION_LABELS, parseBlockConfig, type ChartType, type SeriesPoint, type StackedSeries, type ScatterPoint, type CrossFilter, type Segment } from "@/lib/dashboard-engine";
import { cn } from "@/lib/utils";
import { useT } from "@/components/i18n-provider";

export interface DashboardBlockLite {
  id: string;
  type: string;
  title: string;
  config: string;
}

export interface DataResponse {
  kpi?: number;
  series?: SeriesPoint[];
  rows?: string[][];
  seriesKeys?: StackedSeries["seriesKeys"];
  columns?: string[];
  points?: ScatterPoint[];
  error?: string;
}

export function WidgetCard({
  block,
  slicers,
  crossFilter,
  fieldNameLookup,
  onEdit,
  onDelete,
  onCrossFilter,
  crossFilterActive,
  onData,
  onSegmentClick,
}: {
  /** Drill-down into the tasks behind a clicked segment (or the whole KPI). */
  onSegmentClick?: (segment: Segment) => void;
  /** Reports loaded data upward (feeds the dashboard's "AI Insight"). */
  onData?: (data: DataResponse) => void;
  block: DashboardBlockLite;
  slicers?: CrossFilter[];
  crossFilter?: CrossFilter | null;
  fieldNameLookup: (fieldId: string | undefined) => string | undefined;
  onEdit: () => void;
  onDelete: () => void;
  onCrossFilter?: (point: SeriesPoint) => void;
  crossFilterActive?: string | null;
}) {
  const { t } = useT();
  const [data, setData] = useState<DataResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const config = parseBlockConfig(block.config);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetching this widget's data on mount / config change is exactly what this effect is for
    setLoading(true);
    api
      .post<DataResponse>(`/api/dashboard-blocks/${block.id}/data`, { slicers, crossFilter })
      .then((res) => {
        if (!cancelled) {
          setData(res);
          onData?.(res);
        }
      })
      .catch(() => {
        if (!cancelled) setData({ error: "Failed to load" });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filter objects are rebuilt every render; JSON.stringify keeps the effect from refetching on identity changes alone
  }, [block.id, block.config, JSON.stringify(slicers), JSON.stringify(crossFilter)]);

  const measureLabel = fieldNameLookup(config.measureFieldId) ?? AGGREGATION_LABELS[config.aggregation ?? "count"];
  const measure2Label = fieldNameLookup(config.measure2FieldId);

  return (
    <div className="woli-widget h-full w-full flex flex-col rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden">
      <div className="drag-handle flex items-center gap-1.5 px-2.5 h-8 border-b border-neutral-100 dark:border-neutral-800 cursor-grab shrink-0">
        <GripVertical size={12} className="text-neutral-300 shrink-0" />
        <span className="text-xs font-medium text-neutral-700 dark:text-neutral-200 truncate flex-1">{block.title || "Untitled widget"}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 shrink-0" onMouseDown={(e) => e.stopPropagation()}>
              <MoreHorizontal size={14} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil size={13} /> {t("db.editWidget")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onDelete} className="text-red-600 dark:text-red-400">
              <Trash2 size={13} /> {t("db.deleteWidget")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex-1 min-h-0 p-2 relative">
        {loading && !data ? (
          <div className="h-full w-full animate-pulse bg-neutral-100 dark:bg-neutral-800 rounded-md" />
        ) : data?.error ? (
          <div className="h-full flex items-center justify-center text-xs text-red-500">{data.error}</div>
        ) : block.type === "kpi" ? (
          <KpiDisplay value={data?.kpi ?? 0} label={measureLabel} onClick={onSegmentClick ? () => onSegmentClick({ key: "value", label: measureLabel ?? "" }) : undefined} />
        ) : block.type === "table" ? (
          <TableDisplay columns={data?.columns ?? []} rows={data?.rows ?? []} />
        ) : (
          <ChartRenderer
            type={block.type as ChartType}
            series={data?.series}
            stacked={block.type === "stacked_column" || block.type === "stacked_bar" ? { rows: (data as unknown as { rows: Record<string, string | number>[] })?.rows ?? [], seriesKeys: data?.seriesKeys ?? [] } : undefined}
            scatterPoints={data?.points}
            measureLabel={measureLabel}
            measure2Label={measure2Label}
            onPointClick={!onSegmentClick && onCrossFilter && ["bar", "column", "pie", "donut"].includes(block.type) ? onCrossFilter : undefined}
            onSegmentClick={onSegmentClick}
          />
        )}
        {crossFilterActive && (
          <div className="absolute top-1 right-1 text-[10px] bg-indigo-600 text-white rounded-full px-2 py-0.5">
            Filtered: {crossFilterActive}
          </div>
        )}
      </div>
    </div>
  );
}

function KpiDisplay({ value, label, onClick }: { value: number; label?: string; onClick?: () => void }) {
  const formatted = Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} onClick={onClick} className={cn("h-full w-full flex flex-col items-center justify-center rounded-md", onClick && "hover:bg-indigo-50/60 dark:hover:bg-indigo-950/40")} data-testid="kpi-value">
      <div className="text-3xl font-semibold text-neutral-900 dark:text-neutral-50 tabular-nums">{formatted}</div>
      {label && <div className="text-xs text-neutral-400 mt-1">{label}</div>}
    </Tag>
  );
}

function TableDisplay({ columns, rows }: { columns: string[]; rows: string[][] }) {
  const { t } = useT();
  if (!columns.length) return <div className="h-full flex items-center justify-center text-xs text-neutral-400">{t("db.noColumns")}</div>;
  return (
    <div className="h-full overflow-auto thin-scroll">
      <table className="w-full text-xs border-collapse">
        <thead className="sticky top-0 bg-white dark:bg-neutral-900">
          <tr>
            {columns.map((c, i) => (
              <th key={i} className="text-left font-medium text-neutral-500 border-b border-neutral-200 dark:border-neutral-800 px-2 py-1 whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={cn(i % 2 === 1 && "bg-neutral-50/60 dark:bg-neutral-800/30")}>
              {row.map((cell, j) => (
                <td key={j} className="px-2 py-1 border-b border-neutral-100 dark:border-neutral-900 whitespace-nowrap text-neutral-700 dark:text-neutral-300">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-2 py-4 text-center text-neutral-400">
                No records
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export { CHART_COLORS };

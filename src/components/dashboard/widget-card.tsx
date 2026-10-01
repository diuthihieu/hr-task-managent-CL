"use client";
import { useEffect, useState, type CSSProperties } from "react";
import { MoreHorizontal, Pencil, Trash2, GripVertical, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api-client";
import { ChartRenderer, CHART_COLORS } from "./chart-renderer";
import { AGGREGATION_LABELS, parseBlockConfig, type ChartType, type SeriesPoint, type StackedSeries, type ScatterPoint, type CrossFilter, type KpiTrend, type Segment, type WidgetStyleConfig } from "@/lib/dashboard-engine";
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
  kpiTrend?: KpiTrend | null;
  series?: SeriesPoint[];
  rows?: string[][];
  seriesKeys?: StackedSeries["seriesKeys"];
  columns?: string[];
  points?: ScatterPoint[];
  error?: string;
}

export function WidgetCard({
  block,
  canEdit = true,
  slicers,
  crossFilter,
  fieldNameLookup,
  onEdit,
  onDelete,
  onCrossFilter,
  crossFilterActive,
  onData,
  onSegmentClick,
  readOnly,
}: {
  /** Shown elsewhere (e.g. on Home): no edit menu, no drag handle. */
  readOnly?: boolean;
  /** Drill-down into the tasks behind a clicked segment (or the whole KPI). */
  onSegmentClick?: (segment: Segment) => void;
  /** Reports loaded data upward (feeds the dashboard's "AI Insight"). */
  onData?: (data: DataResponse) => void;
  block: DashboardBlockLite;
  canEdit?: boolean;
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
  const widgetStyle = config.style;

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
  const fontFamily = {
    system: "var(--font-sans), ui-sans-serif, system-ui, sans-serif",
    inter: "Inter, ui-sans-serif, system-ui, sans-serif",
    georgia: "Georgia, Cambria, serif",
    mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
  }[widgetStyle?.fontFamily ?? "system"];
  const shadow = {
    none: "shadow-none",
    small: "shadow-sm",
    medium: "shadow-md",
    large: "shadow-xl",
  }[widgetStyle?.shadow ?? "none"];
  const cardStyle: CSSProperties = {
    backgroundColor: widgetStyle?.backgroundColor,
    color: widgetStyle?.textColor,
    borderColor: widgetStyle?.borderColor,
    borderWidth: widgetStyle?.borderWidth,
    borderRadius: widgetStyle?.borderRadius,
    fontFamily,
    fontSize: widgetStyle?.fontSize,
  };
  const editable = canEdit && !readOnly;

  return (
    <div className={cn("woli-widget h-full w-full flex flex-col rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden", shadow)} style={cardStyle}>
      <div className={cn("flex items-center gap-1.5 px-2.5 h-8 border-b border-neutral-100/70 dark:border-neutral-800/70 shrink-0", editable && "drag-handle cursor-grab")} style={{ borderColor: widgetStyle?.borderColor }}>
        {editable && <GripVertical size={12} className="text-neutral-300 shrink-0" />}
        <span
          className="text-xs font-medium text-neutral-700 dark:text-neutral-200 truncate flex-1"
          style={{
            color: widgetStyle?.textColor,
            fontSize: widgetStyle?.titleSize,
            fontWeight: widgetStyle?.titleWeight === "bold" ? 700 : widgetStyle?.titleWeight === "normal" ? 400 : 500,
            textAlign: widgetStyle?.titleAlign,
          }}
        >
          {block.title || "Untitled widget"}
        </span>
        {editable && <DropdownMenu>
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
        </DropdownMenu>}
      </div>
      <div className="flex-1 min-h-0 p-2 relative">
        {loading && !data ? (
          <div className="h-full w-full animate-pulse bg-neutral-100 dark:bg-neutral-800 rounded-md" />
        ) : data?.error ? (
          <div className="h-full flex items-center justify-center text-xs text-red-500">{data.error}</div>
        ) : block.type === "kpi" ? (
          <KpiDisplay value={data?.kpi ?? 0} label={measureLabel} trend={data?.kpiTrend} style={widgetStyle} onClick={onSegmentClick ? () => onSegmentClick({ key: "value", label: measureLabel ?? "" }) : undefined} />
        ) : block.type === "table" ? (
          <TableDisplay columns={data?.columns ?? []} rows={data?.rows ?? []} style={widgetStyle} />
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
            style={widgetStyle}
            gaugeMax={config.gaugeMax}
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

function KpiDisplay({ value, label, trend, style, onClick }: { value: number; label?: string; trend?: KpiTrend | null; style?: WidgetStyleConfig; onClick?: () => void }) {
  const { t } = useT();
  const formatted = Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
  const TrendIcon = trend?.direction === "up" ? TrendingUp : trend?.direction === "down" ? TrendingDown : Minus;
  const trendText = !trend ? "" : trend.percentChange === null ? `${trend.delta >= 0 ? "+" : ""}${trend.delta.toLocaleString()}` : `${trend.percentChange >= 0 ? "+" : ""}${trend.percentChange.toFixed(1)}%`;
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} onClick={onClick} className={cn("h-full w-full flex flex-col items-center justify-center rounded-md", onClick && "hover:bg-indigo-50/60 dark:hover:bg-indigo-950/40")} data-testid="kpi-value">
      <div className="text-3xl font-semibold text-neutral-900 dark:text-neutral-50 tabular-nums" style={{ color: style?.textColor }}>{formatted}</div>
      {label && <div className="text-xs text-neutral-400 mt-1" style={{ color: style?.textColor }}>{label}</div>}
      {trend && (
        <div className={cn("mt-2 flex items-center gap-1 text-xs tabular-nums", trend.direction === "up" ? "text-emerald-600" : trend.direction === "down" ? "text-red-600" : "text-neutral-500")} title={`${t("db.kpi.previous")}: ${trend.previous.toLocaleString()}`}>
          <TrendIcon size={13} /> {trendText} <span className="text-neutral-400">{t("db.kpi.vsPrevious")}</span>
        </div>
      )}
    </Tag>
  );
}

function TableDisplay({ columns, rows, style }: { columns: string[]; rows: string[][]; style?: WidgetStyleConfig }) {
  const { t } = useT();
  if (!columns.length) return <div className="h-full flex items-center justify-center text-xs text-neutral-400">{t("db.noColumns")}</div>;
  return (
    <div className="h-full overflow-auto thin-scroll">
      <table className="w-full text-xs border-collapse">
        <thead className="sticky top-0 bg-white dark:bg-neutral-900" style={{ backgroundColor: style?.backgroundColor }}>
          <tr>
            {columns.map((c, i) => (
              <th key={i} className="text-left font-medium text-neutral-500 border-b border-neutral-200 dark:border-neutral-800 px-2 py-1 whitespace-nowrap" style={{ color: style?.textColor, borderColor: style?.borderColor }}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={cn(i % 2 === 1 && "bg-neutral-50/60 dark:bg-neutral-800/30")}>
              {row.map((cell, j) => (
                <td key={j} className="px-2 py-1 border-b border-neutral-100 dark:border-neutral-900 whitespace-nowrap text-neutral-700 dark:text-neutral-300" style={{ color: style?.textColor, borderColor: style?.borderColor }}>
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

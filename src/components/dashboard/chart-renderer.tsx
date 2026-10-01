"use client";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ScatterChart,
  Scatter,
  Treemap,
  FunnelChart,
  Funnel,
  LabelList,
  RadialBarChart,
  RadialBar,
  ComposedChart,
} from "recharts";
import type { SeriesPoint, StackedSeries, ScatterPoint, ChartType, Segment, WidgetStyleConfig } from "@/lib/dashboard-engine";

export const CHART_COLORS = ["#6366f1", "#0ea5e9", "#22c55e", "#f97316", "#ec4899", "#8b5cf6", "#eab308", "#ef4444", "#14b8a6", "#a855f7"];

function colorFor(point: { color?: string }, index: number, palette: string[], customPalette: boolean) {
  return (customPalette ? undefined : point.color) || palette[index % palette.length];
}

const tooltipStyle = { fontSize: 12, borderRadius: 8 };

export function ChartRenderer({
  type,
  series,
  stacked,
  scatterPoints,
  measureLabel,
  measure2Label,
  onPointClick,
  onSegmentClick,
  style,
  gaugeMax,
}: {
  type: ChartType;
  series?: SeriesPoint[];
  stacked?: StackedSeries;
  scatterPoints?: ScatterPoint[];
  measureLabel?: string;
  measure2Label?: string;
  onPointClick?: (point: SeriesPoint) => void;
  /** Drill-down: called with the clicked group (and stack, on stacked charts). */
  onSegmentClick?: (segment: Segment) => void;
  style?: WidgetStyleConfig;
  gaugeMax?: number;
}) {
  const clickable = !!(onPointClick || onSegmentClick);
  // Recharts hands back its own item shapes; resolve clicks by index into our series instead.
  const pickSeries = (data: SeriesPoint[], index: unknown) => {
    const p = data[Number(index)];
    if (!p) return;
    onPointClick?.(p);
    onSegmentClick?.({ key: p.key, label: p.label });
  };
  const chartClick = (data: SeriesPoint[]) =>
    onSegmentClick ? (state: unknown) => pickSeries(data, (state as { activeTooltipIndex?: unknown } | null)?.activeTooltipIndex) : undefined;
  const palette = style?.palette?.length ? style.palette : CHART_COLORS;
  const customPalette = Boolean(style?.palette?.length);
  const primary = palette[0] ?? CHART_COLORS[0];
  const secondary = palette[1] ?? CHART_COLORS[3];
  const axisTick = { fontSize: style?.fontSize ?? 11, fill: style?.textColor };
  const gridColor = style?.gridColor ?? "#9ca3af55";
  const showGrid = style?.showGrid !== false;
  const showLegend = style?.showLegend !== false;
  const showDataLabels = style?.showDataLabels === true;
  const lineWidth = Math.max(1, Math.min(8, style?.lineWidth ?? 2));
  const barRadius = Math.max(0, Math.min(24, style?.barRadius ?? 4));
  if (type === "column" || type === "bar") {
    const data = series ?? [];
    const horizontal = type === "bar";
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 4, right: 8, bottom: 4, left: 4 }}>
          {showGrid && <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />}
          {horizontal ? (
            <>
              <XAxis type="number" tick={axisTick} />
              <YAxis type="category" dataKey="label" tick={axisTick} width={90} />
            </>
          ) : (
            <>
              <XAxis dataKey="label" tick={axisTick} interval={0} angle={data.length > 6 ? -30 : 0} textAnchor={data.length > 6 ? "end" : "middle"} height={data.length > 6 ? 50 : 24} />
              <YAxis tick={axisTick} />
            </>
          )}
          <Tooltip contentStyle={tooltipStyle} />
          <Bar
            dataKey="value"
            name={measureLabel ?? "Value"}
            radius={[barRadius, barRadius, 0, 0]}
            cursor={clickable ? "pointer" : undefined}
            onClick={(_: unknown, index: number) => pickSeries(data, index)}
          >
            {data.map((d, i) => (
              <Cell key={d.key} fill={colorFor(d, i, palette, customPalette)} />
            ))}
            {showDataLabels && <LabelList dataKey="value" position={horizontal ? "right" : "top"} fill={style?.textColor} fontSize={style?.fontSize ?? 10} />}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (type === "stacked_column" || type === "stacked_bar") {
    const rows = stacked?.rows ?? [];
    const keys = stacked?.seriesKeys ?? [];
    const horizontal = type === "stacked_bar";
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 4, right: 8, bottom: 4, left: 4 }}>
          {showGrid && <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />}
          {horizontal ? (
            <>
              <XAxis type="number" tick={axisTick} />
              <YAxis type="category" dataKey="label" tick={axisTick} width={90} />
            </>
          ) : (
            <>
              <XAxis dataKey="label" tick={axisTick} />
              <YAxis tick={axisTick} />
            </>
          )}
          <Tooltip contentStyle={tooltipStyle} />
          {showLegend && <Legend wrapperStyle={{ fontSize: style?.fontSize ?? 11 }} />}
          {keys.map((k, i) => (
            <Bar
              key={k.key}
              dataKey={k.key}
              name={k.label}
              stackId="stack"
              fill={(customPalette ? undefined : k.color) || palette[i % palette.length]}
              radius={[barRadius, barRadius, 0, 0]}
              cursor={onSegmentClick ? "pointer" : undefined}
              onClick={(_: unknown, index: number) => {
                const row = rows[index];
                if (row && onSegmentClick) onSegmentClick({ key: String(row.__rowKey), label: String(row.label), seriesKey: k.key, seriesLabel: k.label });
              }}
            >
              {showDataLabels && <LabelList dataKey={k.key} position="center" fill={style?.textColor ?? "white"} fontSize={style?.fontSize ?? 10} />}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (type === "line" || type === "area") {
    const data = series ?? [];
    const Chart = type === "line" ? LineChart : AreaChart;
    return (
      <ResponsiveContainer width="100%" height="100%">
        <Chart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 4 }} onClick={chartClick(data)} style={onSegmentClick ? { cursor: "pointer" } : undefined}>
          {showGrid && <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />}
          <XAxis dataKey="label" tick={axisTick} />
          <YAxis tick={axisTick} />
          <Tooltip contentStyle={tooltipStyle} />
          {type === "line" ? (
            <Line type="monotone" dataKey="value" name={measureLabel ?? "Value"} stroke={primary} strokeWidth={lineWidth} dot={{ r: Math.max(2, lineWidth + 1) }}>
              {showDataLabels && <LabelList dataKey="value" position="top" fill={style?.textColor} fontSize={style?.fontSize ?? 10} />}
            </Line>
          ) : (
            <Area type="monotone" dataKey="value" name={measureLabel ?? "Value"} stroke={primary} strokeWidth={lineWidth} fill={primary} fillOpacity={0.25}>
              {showDataLabels && <LabelList dataKey="value" position="top" fill={style?.textColor} fontSize={style?.fontSize ?? 10} />}
            </Area>
          )}
        </Chart>
      </ResponsiveContainer>
    );
  }

  if (type === "combo") {
    const data = series ?? [];
    return (
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 4 }} onClick={chartClick(data)} style={onSegmentClick ? { cursor: "pointer" } : undefined}>
          {showGrid && <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />}
          <XAxis dataKey="label" tick={axisTick} />
          <YAxis tick={axisTick} />
          <Tooltip contentStyle={tooltipStyle} />
          {showLegend && <Legend wrapperStyle={{ fontSize: style?.fontSize ?? 11 }} />}
          <Bar dataKey="value" name={measureLabel ?? "Value"} fill={primary} radius={[barRadius, barRadius, 0, 0]}>
            {showDataLabels && <LabelList dataKey="value" position="top" fill={style?.textColor} fontSize={style?.fontSize ?? 10} />}
          </Bar>
          <Line type="monotone" dataKey="value2" name={measure2Label ?? "Value 2"} stroke={secondary} strokeWidth={lineWidth} />
        </ComposedChart>
      </ResponsiveContainer>
    );
  }

  if (type === "pie" || type === "donut") {
    const data = series ?? [];
    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip contentStyle={tooltipStyle} />
          {showLegend && <Legend wrapperStyle={{ fontSize: style?.fontSize ?? 11 }} />}
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            innerRadius={type === "donut" ? `${Math.max(20, Math.min(80, style?.donutInnerRadius ?? 55))}%` : 0}
            outerRadius="80%"
            paddingAngle={2}
            cursor={clickable ? "pointer" : undefined}
            onClick={(_: unknown, index: number) => pickSeries(data, index)}
            label={showDataLabels ? { fill: style?.textColor, fontSize: style?.fontSize ?? 10 } : false}
          >
            {data.map((d, i) => (
              <Cell key={d.key} fill={colorFor(d, i, palette, customPalette)} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (type === "radar") {
    const data = series ?? [];
    return (
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} onClick={chartClick(data)}>
          {showGrid && <PolarGrid stroke={gridColor} />}
          <PolarAngleAxis dataKey="label" tick={axisTick} />
          <PolarRadiusAxis tick={axisTick} />
          <Tooltip contentStyle={tooltipStyle} />
          <Radar dataKey="value" name={measureLabel ?? "Value"} stroke={primary} strokeWidth={lineWidth} fill={primary} fillOpacity={0.35} />
        </RadarChart>
      </ResponsiveContainer>
    );
  }

  if (type === "scatter") {
    const points = scatterPoints ?? [];
    return (
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 4, right: 8, bottom: 4, left: 4 }}>
          {showGrid && <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />}
          <XAxis type="number" dataKey="x" name={measure2Label ?? "X"} tick={axisTick} />
          <YAxis type="number" dataKey="y" name={measureLabel ?? "Y"} tick={axisTick} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ strokeDasharray: "3 3" }} />
          <Scatter data={points} fill={primary} />
        </ScatterChart>
      </ResponsiveContainer>
    );
  }

  if (type === "treemap") {
    const data = (series ?? []).map((d, i) => ({ name: d.label, size: Math.max(d.value, 0.01), fill: colorFor(d, i, palette, customPalette) }));
    return (
      <ResponsiveContainer width="100%" height="100%">
        <Treemap
          data={data}
          dataKey="size"
          nameKey="name"
          stroke={style?.backgroundColor ?? "#fff"}
          fill={primary}
          onClick={(node: unknown) => pickSeries(series ?? [], (series ?? []).findIndex((d) => d.label === (node as { name?: string })?.name))}
        >
          <Tooltip contentStyle={tooltipStyle} />
        </Treemap>
      </ResponsiveContainer>
    );
  }

  if (type === "funnel") {
    const data = (series ?? []).map((d, i) => ({ name: d.label, value: d.value, fill: colorFor(d, i, palette, customPalette) }));
    return (
      <ResponsiveContainer width="100%" height="100%">
        <FunnelChart>
          <Tooltip contentStyle={tooltipStyle} />
          <Funnel dataKey="value" data={data} isAnimationActive={false} cursor={clickable ? "pointer" : undefined} onClick={(_: unknown, index: number) => pickSeries(series ?? [], index)}>
            {showDataLabels !== false && <LabelList dataKey="name" position="right" fill={style?.textColor ?? "#6b7280"} fontSize={style?.fontSize ?? 11} />}
          </Funnel>
        </FunnelChart>
      </ResponsiveContainer>
    );
  }

  if (type === "gauge") {
    const value = series?.[0]?.value ?? 0;
    const max = Math.max(value, gaugeMax ?? 100);
    const data = [{ name: "value", value, fill: primary }];
    return (
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart data={data} innerRadius="65%" outerRadius="100%" startAngle={180} endAngle={0} barSize={16} cx="50%" cy="85%">
          <RadialBar dataKey="value" background={{ fill: "#9ca3af55" }} cornerRadius={8} max={max} />
        </RadialBarChart>
      </ResponsiveContainer>
    );
  }

  return <div className="flex items-center justify-center h-full text-xs text-neutral-400">Unsupported chart type</div>;
}

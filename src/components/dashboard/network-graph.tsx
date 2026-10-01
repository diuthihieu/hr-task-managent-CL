"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { RotateCcw } from "lucide-react";
import type { NetworkGraphData, WidgetStyleConfig } from "@/lib/dashboard-engine";
import { circularGraphLayout, linkedCircularLayout, type GraphPosition } from "@/lib/radial-graph";
import { useT } from "@/components/i18n-provider";

const WIDTH = 800;
const HEIGHT = 480;
const NODE_RADIUS = 17;

export function NetworkGraph({ data, style }: { data: NetworkGraphData; style?: WidgetStyleConfig }) {
  const { t } = useT();
  const svgRef = useRef<SVGSVGElement>(null);
  const nodeIds = useMemo(() => data.nodes.map((node) => node.id), [data.nodes]);
  const [positions, setPositions] = useState<Record<string, GraphPosition>>(() => circularGraphLayout(nodeIds, { width: WIDTH, height: HEIGHT }, { nodeRadius: NODE_RADIUS }));
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const palette = style?.palette?.length ? style.palette : ["#6366f1", "#0ea5e9", "#22c55e", "#f97316", "#ec4899"];

  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const node of data.nodes) map.set(node.id, new Set());
    for (const edge of data.edges) {
      map.get(edge.source)?.add(edge.target);
      map.get(edge.target)?.add(edge.source);
    }
    return map;
  }, [data]);

  const reset = () => {
    setPositions(circularGraphLayout(nodeIds, { width: WIDTH, height: HEIGHT }, { nodeRadius: NODE_RADIUS }));
    setFocusedId(null);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- graph data changes require a deterministic fresh circular layout
    setPositions(circularGraphLayout(nodeIds, { width: WIDTH, height: HEIGHT }, { nodeRadius: NODE_RADIUS }));
    setFocusedId(null);
  }, [nodeIds]);

  function point(event: ReactPointerEvent<SVGGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: WIDTH / 2, y: HEIGHT / 2 };
    return {
      x: ((event.clientX - rect.left) / rect.width) * WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * HEIGHT,
    };
  }

  function arrangeAround(nodeId: string, anchor: GraphPosition) {
    setPositions((current) => linkedCircularLayout(nodeId, [...(neighbours.get(nodeId) ?? [])], anchor, { width: WIDTH, height: HEIGHT }, current, { nodeRadius: NODE_RADIUS }));
  }

  function pointerDown(event: ReactPointerEvent<SVGGElement>, nodeId: string) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraggingId(nodeId);
    setFocusedId(nodeId);
    arrangeAround(nodeId, point(event));
  }

  function pointerMove(event: ReactPointerEvent<SVGGElement>, nodeId: string) {
    if (draggingId !== nodeId) return;
    arrangeAround(nodeId, point(event));
  }

  const activeNeighbours = focusedId ? neighbours.get(focusedId) ?? new Set<string>() : new Set<string>();
  if (!data.nodes.length) return <div className="h-full flex items-center justify-center text-xs text-neutral-400">{t("db.network.empty")}</div>;

  return (
    <div className="relative h-full w-full overflow-hidden">
      <button
        type="button"
        onClick={reset}
        className="absolute right-1 top-1 z-10 inline-flex items-center gap-1 rounded-md bg-white/85 dark:bg-neutral-900/85 px-2 py-1 text-[10px] text-neutral-500 shadow-sm hover:text-indigo-600"
        title={t("db.network.reset")}
      >
        <RotateCcw size={11} /> {t("db.network.reset")}
      </button>
      <svg ref={svgRef} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-full w-full touch-none select-none" role="img" aria-label={t("db.network.aria")}>
        {data.edges.map((edge) => {
          const source = positions[edge.source];
          const target = positions[edge.target];
          if (!source || !target) return null;
          const active = focusedId === edge.source || focusedId === edge.target;
          return (
            <line
              key={`${edge.source}:${edge.target}`}
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              stroke={active ? palette[0] : style?.gridColor ?? "#94a3b8"}
              strokeWidth={active ? 2.5 : 1.2}
              opacity={active ? 0.9 : 0.4}
              className="transition-all duration-200"
            />
          );
        })}
        {data.nodes.map((node, index) => {
          const position = positions[node.id];
          if (!position) return null;
          const active = focusedId === node.id;
          const linked = activeNeighbours.has(node.id);
          return (
            <g
              key={node.id}
              transform={`translate(${position.x},${position.y})`}
              onPointerDown={(event) => pointerDown(event, node.id)}
              onPointerMove={(event) => pointerMove(event, node.id)}
              onPointerUp={() => setDraggingId(null)}
              onPointerCancel={() => setDraggingId(null)}
              className={draggingId === node.id ? "cursor-grabbing" : "cursor-grab"}
              style={{ transition: draggingId ? undefined : "transform 220ms ease-out" }}
            >
              <title>{node.label}</title>
              {(active || linked) && <circle r={NODE_RADIUS + 6} fill="none" stroke={palette[0]} strokeWidth={1.5} opacity={active ? 0.8 : 0.35} />}
              <circle r={NODE_RADIUS} fill={palette[index % palette.length]} stroke={style?.backgroundColor ?? "white"} strokeWidth={2.5} />
              <text
                y={NODE_RADIUS + 15}
                textAnchor="middle"
                fill={style?.textColor ?? "currentColor"}
                fontSize={Math.max(9, Math.min(14, style?.fontSize ?? 11))}
                className="pointer-events-none"
              >
                {node.label.length > 16 ? `${node.label.slice(0, 15)}…` : node.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

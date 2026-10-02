"use client";

// Canvas renderer for the Wiki / Second Brain knowledge graph. The graph uses
// deterministic circular rings instead of an unconstrained force layout: a
// dragged node becomes the centre, its direct links form the inner ring(s),
// and all remaining nodes settle on outer rings with a guaranteed gap.
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from "react-force-graph-2d";
import { GRAPH_COLORS, type GraphLink, type GraphNode } from "@/lib/knowledge-graph-core";
import { anchoredCircularGraphLayout, circularMotionPosition, concentricCircularLayout, type GraphPosition } from "@/lib/radial-graph";

export type CanvasNode = NodeObject<
  GraphNode & {
    x?: number;
    y?: number;
    vx?: number;
    vy?: number;
    fx?: number;
    fy?: number;
  }
>;
type CanvasLink = LinkObject<CanvasNode, GraphLink>;

export interface GraphCanvasHandle {
  zoomToFit: () => void;
  zoomBy: (factor: number) => void;
  focusNode: (id: string) => boolean;
}

export const RING = 90;
const NODE_RADIUS = 13;
const NODE_GAP = 22;
const MAX_FIT_ZOOM = 1.8;

const radius = (node: GraphNode, focus?: string) =>
  node.id === focus ? 11 : Math.min(3.5 + Math.sqrt(node.degree) * 1.7, NODE_RADIUS);
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );

interface RingOverlay {
  center: GraphPosition;
  radii: number[];
}

function overlayFor(positions: Record<string, GraphPosition>, center: GraphPosition): RingOverlay {
  const radii = [...new Set(
    Object.values(positions)
      .map((position) => Math.round(Math.hypot(position.x - center.x, position.y - center.y)))
      .filter((value) => value > 0),
  )].sort((a, b) => a - b);
  return { center, radii };
}

function initialCircularLayout(nodes: GraphNode[], focus?: string) {
  const ordered = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  if (!focus) {
    return concentricCircularLayout(
      ordered.map((node) => node.id),
      { x: 0, y: 0 },
      { nodeRadius: NODE_RADIUS, minGap: NODE_GAP, firstRingRadius: RING },
    );
  }

  const positions: Record<string, GraphPosition> = { [focus]: { x: 0, y: 0 } };
  const depths = [...new Set(ordered.filter((node) => node.id !== focus).map((node) => node.depth ?? 1))].sort((a, b) => a - b);
  let firstRingRadius = RING;
  for (const depth of depths) {
    const ids = ordered.filter((node) => node.id !== focus && (node.depth ?? 1) === depth).map((node) => node.id);
    const layer = concentricCircularLayout(ids, { x: 0, y: 0 }, { nodeRadius: NODE_RADIUS, minGap: NODE_GAP, firstRingRadius });
    Object.assign(positions, layer);
    const outerRadius = ids.length ? Math.max(...ids.map((id) => Math.hypot(layer[id].x, layer[id].y))) : firstRingRadius;
    firstRingRadius = outerRadius + RING;
  }
  return positions;
}

export interface GraphCanvasProps {
  nodes: GraphNode[];
  links: GraphLink[];
  width: number;
  height: number;
  focus?: string;
  rings?: number;
  dark: boolean;
  typeLabel: (type: GraphNode["type"]) => string;
  linksLabel: (count: number) => string;
  onOpen: (node: GraphNode) => void;
  onFocus: (node: GraphNode) => void;
  handleRef?: React.Ref<GraphCanvasHandle>;
}

export default function GraphCanvas({
  nodes,
  links,
  width,
  height,
  focus,
  dark,
  typeLabel,
  linksLabel,
  onOpen,
  onFocus,
  handleRef,
}: GraphCanvasProps) {
  const fg = useRef<ForceGraphMethods<CanvasNode, CanvasLink> | undefined>(undefined);
  const [hover, setHover] = useState<string | null>(null);

  const prepared = useMemo(() => {
    const positions = initialCircularLayout(nodes, focus);
    const canvasNodes: CanvasNode[] = nodes.map((node) => {
      const position = positions[node.id] ?? { x: 0, y: 0 };
      return { ...node, x: position.x, y: position.y, fx: position.x, fy: position.y };
    });
    return {
      data: { nodes: canvasNodes, links: links.map((link) => ({ ...link })) as CanvasLink[] },
      overlay: overlayFor(positions, { x: 0, y: 0 }),
      positions,
    };
  }, [nodes, links, focus]);
  const data = prepared.data;
  const ringOverlay = useRef<RingOverlay>(prepared.overlay);
  const targetPositions = useRef<Record<string, GraphPosition>>(prepared.positions);
  const basePositions = useRef<Record<string, GraphPosition>>(prepared.positions);
  const dragging = useRef<string | null>(null);
  const nodeById = useMemo(() => new Map(data.nodes.map((node) => [node.id as string, node])), [data.nodes]);
  const visibleNodeIds = useMemo(() => new Set(nodeById.keys()), [nodeById]);

  useEffect(() => {
    ringOverlay.current = prepared.overlay;
    targetPositions.current = prepared.positions;
    basePositions.current = prepared.positions;
  }, [prepared]);

  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const link of links) {
      (map.get(link.source) ?? map.set(link.source, new Set()).get(link.source)!).add(link.target);
      (map.get(link.target) ?? map.set(link.target, new Set()).get(link.target)!).add(link.source);
    }
    return map;
  }, [links]);

  const isLit = useCallback(
    (id: string) => !hover || id === hover || !!neighbours.get(hover)?.has(id),
    [hover, neighbours],
  );

  const targetArrangement = useCallback(
    (positions: Record<string, GraphPosition>) => {
      targetPositions.current = { ...targetPositions.current, ...positions };
    },
    [],
  );

  const arrangeAround = useCallback(
    (node: CanvasNode, includeAll: boolean) => {
      const id = node.id as string;
      const center = { x: node.x ?? node.fx ?? 0, y: node.y ?? node.fy ?? 0 };
      const linked = [...(neighbours.get(id) ?? [])].filter((linkedId) => visibleNodeIds.has(linkedId));
      const ids = includeAll ? data.nodes.map((candidate) => candidate.id as string) : [id, ...linked];
      const positions = anchoredCircularGraphLayout(ids, id, linked, center, {
        nodeRadius: NODE_RADIUS,
        minGap: NODE_GAP,
        firstRingRadius: RING,
      });
      targetArrangement(positions);
      ringOverlay.current = overlayFor(positions, center);
    },
    [data.nodes, neighbours, targetArrangement, visibleNodeIds],
  );

  const resetArrangement = useCallback(() => {
    targetPositions.current = prepared.positions;
    ringOverlay.current = prepared.overlay;
  }, [prepared]);

  useImperativeHandle(handleRef, () => ({
    zoomToFit: () => {
      fg.current?.zoomToFit(500, 48);
      window.setTimeout(() => {
        const graph = fg.current;
        if (graph && graph.zoom() > MAX_FIT_ZOOM) graph.zoom(MAX_FIT_ZOOM, 250);
      }, 520);
    },
    zoomBy: (factor) => {
      const graph = fg.current;
      if (graph) graph.zoom(graph.zoom() * factor, 250);
    },
    focusNode: (id) => {
      const node = data.nodes.find((candidate) => candidate.id === id);
      if (!node || node.x === undefined || node.y === undefined) return false;
      fg.current?.centerAt(node.x, node.y, 500);
      fg.current?.zoom(3, 500);
      setHover(id);
      arrangeAround(node, true);
      return true;
    },
  }), [arrangeAround, data.nodes]);

  const drawNode = useCallback(
    (node: CanvasNode, context: CanvasRenderingContext2D, scale: number) => {
      const nodeRadius = radius(node, focus);
      const lit = isLit(node.id as string);
      context.globalAlpha = lit ? 1 : 0.15;
      if (node.id === focus || node.id === hover) {
        context.beginPath();
        context.arc(node.x!, node.y!, nodeRadius + 4, 0, 2 * Math.PI);
        context.fillStyle = `${GRAPH_COLORS[node.type]}33`;
        context.fill();
      }
      context.beginPath();
      context.arc(node.x!, node.y!, nodeRadius, 0, 2 * Math.PI);
      context.fillStyle = GRAPH_COLORS[node.type];
      context.fill();
      if (node.done) {
        context.lineWidth = 1.2 / scale;
        context.strokeStyle = dark ? "#0a0a0a" : "#ffffff";
        context.stroke();
      }
      const showLabel = node.id === focus || node.id === hover || (hover ? lit : scale > 1.6 || node.degree >= 8 || (focus && node.depth === 1));
      if (showLabel) {
        const size = Math.max(10 / scale, 2.2);
        context.font = `${node.id === focus ? "600 " : ""}${size}px Inter, system-ui, sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "top";
        const text = node.label.length > 40 ? `${node.label.slice(0, 38)}…` : node.label;
        context.fillStyle = dark ? "rgba(229,229,229,0.92)" : "rgba(38,38,38,0.92)";
        context.fillText(text, node.x!, node.y! + nodeRadius + 2);
      }
      context.globalAlpha = 1;
    },
    [dark, focus, hover, isLit],
  );

  const drawRings = useCallback(
    (context: CanvasRenderingContext2D, scale: number) => {
      const overlay = ringOverlay.current;
      const step = Math.max(1, Math.ceil(overlay.radii.length / 12));
      const visibleRadii = overlay.radii.filter((_, index) => index % step === 0 || index === overlay.radii.length - 1);
      context.save();
      context.setLineDash([4 / scale, 6 / scale]);
      context.lineWidth = 1 / scale;
      context.strokeStyle = dark ? "rgba(163,163,163,0.18)" : "rgba(115,115,115,0.18)";
      for (const ringRadius of visibleRadii) {
        context.beginPath();
        context.arc(overlay.center.x, overlay.center.y, ringRadius, 0, 2 * Math.PI);
        context.stroke();
      }
      context.restore();
    },
    [dark],
  );

  const animateCircularMotion = useCallback((context: CanvasRenderingContext2D, scale: number) => {
    const now = performance.now();
    const center = ringOverlay.current.center;
    for (const node of data.nodes) {
      const id = node.id as string;
      if (dragging.current === id) continue;
      const target = targetPositions.current[id];
      if (!target) continue;
      const current = basePositions.current[id] ?? target;
      const base = {
        x: current.x + (target.x - current.x) * 0.075,
        y: current.y + (target.y - current.y) * 0.075,
      };
      basePositions.current[id] = base;
      let hash = 0;
      for (let index = 0; index < id.length; index++) hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
      const phase = (hash % 6283) / 1000;
      const { x, y } = circularMotionPosition(base, center, phase, now, !!hover);
      Object.assign(node, { x, y, fx: x, fy: y, vx: 0, vy: 0 });
    }
    drawRings(context, scale);
  }, [data.nodes, drawRings, hover]);

  const endId = (end: string | number | CanvasNode | undefined) =>
    typeof end === "object" ? (end?.id as string) : (end as string);

  return (
    <ForceGraph2D<CanvasNode, CanvasLink>
      ref={fg}
      graphData={data}
      width={width}
      height={height}
      backgroundColor="rgba(0,0,0,0)"
      nodeId="id"
      nodeRelSize={1}
      nodeVal={(node) => radius(node, focus) ** 2}
      nodeCanvasObject={drawNode}
      nodePointerAreaPaint={(node, color, context) => {
        context.fillStyle = color;
        context.beginPath();
        context.arc(node.x!, node.y!, radius(node, focus) + 2, 0, 2 * Math.PI);
        context.fill();
      }}
      nodeLabel={(node) =>
        `<div style="font:12px Inter,system-ui,sans-serif;max-width:260px;padding:6px 8px;border-radius:8px;background:${dark ? "#171717" : "#ffffff"};color:${dark ? "#f5f5f5" : "#171717"};box-shadow:0 4px 14px rgba(0,0,0,.18);border:1px solid ${dark ? "#262626" : "#e5e5e5"}">` +
        `<div style="display:flex;align-items:center;gap:6px;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:${GRAPH_COLORS[node.type]};font-weight:700"><span style="width:8px;height:8px;border-radius:50%;background:${GRAPH_COLORS[node.type]}"></span>${escapeHtml(typeLabel(node.type))}</div>` +
        `<div style="font-weight:600;margin-top:2px">${escapeHtml(node.label)}</div>` +
        (node.sub ? `<div style="opacity:.7;margin-top:1px">${escapeHtml(node.sub)}</div>` : "") +
        `<div style="opacity:.6;margin-top:3px">${escapeHtml(linksLabel(node.degree))}</div></div>`
      }
      linkColor={(link) => {
        const lit = !hover || endId(link.source) === hover || endId(link.target) === hover;
        return dark
          ? lit ? "rgba(163,163,163,0.45)" : "rgba(163,163,163,0.06)"
          : lit ? "rgba(115,115,115,0.4)" : "rgba(115,115,115,0.06)";
      }}
      linkWidth={(link) => hover && (endId(link.source) === hover || endId(link.target) === hover) ? 1.6 : 0.6}
      onRenderFramePre={animateCircularMotion}
      onNodeHover={(node) => {
        const id = node ? (node.id as string) : null;
        setHover(id);
        if (dragging.current) return;
        if (node) arrangeAround(node, true);
        else resetArrangement();
      }}
      onNodeClick={(node) => onOpen(node)}
      onNodeRightClick={(node) => onFocus(node)}
      onNodeDrag={(node) => {
        const id = node.id as string;
        dragging.current = id;
        const position = { x: node.x ?? 0, y: node.y ?? 0 };
        basePositions.current[id] = position;
        targetPositions.current[id] = position;
        arrangeAround(node, false);
      }}
      onNodeDragEnd={(node) => {
        const id = node.id as string;
        const position = { x: node.x ?? 0, y: node.y ?? 0 };
        basePositions.current[id] = position;
        dragging.current = null;
        arrangeAround(node, true);
      }}
      cooldownTicks={1}
      onEngineStop={() => undefined}
    />
  );
}

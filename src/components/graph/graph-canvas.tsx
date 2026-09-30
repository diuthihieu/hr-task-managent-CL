"use client";
// Canvas renderer for the knowledge graph (react-force-graph-2d = d3-force +
// canvas). Loaded only in the browser (see knowledge-graph-view.tsx).
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import ForceGraph2D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from "react-force-graph-2d";
import { forceCollide, forceRadial } from "d3-force";
import {
  GRAPH_COLORS,
  type GraphLink,
  type GraphNode,
} from "@/lib/knowledge-graph-core";

export type CanvasNode = NodeObject<
  GraphNode & { x?: number; y?: number; fx?: number; fy?: number }
>;
type CanvasLink = LinkObject<CanvasNode, GraphLink>;

export interface GraphCanvasHandle {
  zoomToFit: () => void;
  zoomBy: (factor: number) => void;
  focusNode: (id: string) => boolean;
}

/** Distance between the concentric rings of the local graph (graph units). */
export const RING = 90;
const MAX_FIT_ZOOM = 1.8;

const radius = (n: GraphNode, focus?: string) =>
  n.id === focus ? 11 : Math.min(3.5 + Math.sqrt(n.degree) * 1.7, 13);
const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

export interface GraphCanvasProps {
  nodes: GraphNode[];
  links: GraphLink[];
  width: number;
  height: number;
  /** Local mode: centre node id and ring count. */
  focus?: string;
  rings?: number;
  dark: boolean;
  typeLabel: (t: GraphNode["type"]) => string;
  linksLabel: (n: number) => string;
  onOpen: (n: GraphNode) => void;
  onFocus: (n: GraphNode) => void;
  /** Imperative controls for the toolbar (next/dynamic does not forward refs, so it is a prop). */
  handleRef?: React.Ref<GraphCanvasHandle>;
}

export default function GraphCanvas({
  nodes,
  links,
  width,
  height,
  focus,
  rings = 0,
  dark,
  typeLabel,
  linksLabel,
  onOpen,
  onFocus,
  handleRef,
}: GraphCanvasProps) {
  const fg = useRef<ForceGraphMethods<CanvasNode, CanvasLink> | undefined>(
    undefined,
  );
  const [hover, setHover] = useState<string | null>(null);

  // Fresh objects per data set: d3 mutates them (x, y, vx…).
  const data = useMemo(() => {
    const ns: CanvasNode[] = nodes.map((n) => ({ ...n }));
    if (focus) {
      const c = ns.find((n) => n.id === focus);
      if (c) Object.assign(c, { fx: 0, fy: 0, x: 0, y: 0 });
    }
    return { nodes: ns, links: links.map((l) => ({ ...l })) as CanvasLink[] };
  }, [nodes, links, focus]);

  const neighbours = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of links) {
      (m.get(l.source) ?? m.set(l.source, new Set()).get(l.source)!).add(
        l.target,
      );
      (m.get(l.target) ?? m.set(l.target, new Set()).get(l.target)!).add(
        l.source,
      );
    }
    return m;
  }, [links]);
  const lit = (id: string) =>
    !hover || id === hover || !!neighbours.get(hover)?.has(id);

  // Forces: local mode pulls each ring onto its circle; global mode spreads clusters.
  useEffect(() => {
    const g = fg.current;
    if (!g) return;
    g.d3Force(
      "collide",
      forceCollide<CanvasNode>((n) => radius(n, focus) + 3),
    );
    if (focus) {
      g.d3Force(
        "radial",
        forceRadial<CanvasNode>((n) => (n.depth ?? 0) * RING, 0, 0).strength(
          0.9,
        ),
      );
      g.d3Force("charge")?.strength(-60);
      g.d3Force("link")
        ?.distance(RING * 0.6)
        .strength(0.05);
    } else {
      g.d3Force("radial", null);
      g.d3Force("charge")?.strength(-130).distanceMax(420);
      g.d3Force("link")?.distance(55).strength(0.35);
    }
    g.d3ReheatSimulation();
  }, [data, focus]);

  useImperativeHandle(handleRef, () => ({
    zoomToFit: () => {
      // Small graphs would be blown up to fill the screen; cap the fit zoom.
      fg.current?.zoomToFit(500, 48);
      window.setTimeout(() => {
        const g = fg.current;
        if (g && g.zoom() > MAX_FIT_ZOOM) g.zoom(MAX_FIT_ZOOM, 250);
      }, 520);
    },
    zoomBy: (f) => {
      const g = fg.current;
      if (g) g.zoom(g.zoom() * f, 250);
    },
    focusNode: (id) => {
      const n = data.nodes.find((x) => x.id === id);
      if (!n || n.x === undefined || n.y === undefined) return false;
      fg.current?.centerAt(n.x, n.y, 500);
      fg.current?.zoom(3, 500);
      setHover(id);
      return true;
    },
  }));

  const drawNode = useCallback(
    (node: CanvasNode, ctx: CanvasRenderingContext2D, scale: number) => {
      const r = radius(node, focus);
      const on = lit(node.id);
      ctx.globalAlpha = on ? 1 : 0.15;
      if (node.id === focus || node.id === hover) {
        ctx.beginPath();
        ctx.arc(node.x!, node.y!, r + 4, 0, 2 * Math.PI);
        ctx.fillStyle = `${GRAPH_COLORS[node.type]}33`;
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(node.x!, node.y!, r, 0, 2 * Math.PI);
      ctx.fillStyle = GRAPH_COLORS[node.type];
      ctx.fill();
      if (node.done) {
        ctx.lineWidth = 1.2 / scale;
        ctx.strokeStyle = dark ? "#0a0a0a" : "#ffffff";
        ctx.stroke();
      }
      // Labels: always for the centre / hovered node and its neighbours, otherwise when zoomed in or for hubs.
      const showLabel =
        node.id === focus ||
        node.id === hover ||
        (hover
          ? on
          : scale > 1.6 || node.degree >= 8 || (focus && node.depth === 1));
      if (showLabel) {
        const size = Math.max(10 / scale, 2.2);
        ctx.font = `${node.id === focus ? "600 " : ""}${size}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        const text =
          node.label.length > 40 ? `${node.label.slice(0, 38)}…` : node.label;
        ctx.fillStyle = dark ? "rgba(229,229,229,0.92)" : "rgba(38,38,38,0.92)";
        ctx.fillText(text, node.x!, node.y! + r + 2);
      }
      ctx.globalAlpha = 1;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `lit` reads hover/neighbours listed here
    [focus, hover, neighbours, dark],
  );

  const drawRings = useCallback(
    (ctx: CanvasRenderingContext2D, scale: number) => {
      if (!focus || !rings) return;
      ctx.save();
      for (let k = 1; k <= rings; k++) {
        ctx.beginPath();
        ctx.arc(0, 0, k * RING, 0, 2 * Math.PI);
        ctx.setLineDash([4 / scale, 6 / scale]);
        ctx.lineWidth = 1 / scale;
        ctx.strokeStyle = dark
          ? "rgba(163,163,163,0.25)"
          : "rgba(115,115,115,0.25)";
        ctx.stroke();
      }
      ctx.restore();
    },
    [focus, rings, dark],
  );

  const endId = (e: string | number | CanvasNode | undefined) =>
    typeof e === "object" ? (e?.id as string) : (e as string);

  return (
    <ForceGraph2D<CanvasNode, CanvasLink>
      ref={fg}
      graphData={data}
      width={width}
      height={height}
      backgroundColor="rgba(0,0,0,0)"
      nodeId="id"
      nodeRelSize={1}
      nodeVal={(n) => radius(n, focus) ** 2}
      nodeCanvasObject={drawNode}
      nodePointerAreaPaint={(n, color, ctx) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(n.x!, n.y!, radius(n, focus) + 2, 0, 2 * Math.PI);
        ctx.fill();
      }}
      nodeLabel={(n) =>
        `<div style="font:12px Inter,system-ui,sans-serif;max-width:260px;padding:6px 8px;border-radius:8px;background:${dark ? "#171717" : "#ffffff"};color:${dark ? "#f5f5f5" : "#171717"};box-shadow:0 4px 14px rgba(0,0,0,.18);border:1px solid ${dark ? "#262626" : "#e5e5e5"}">` +
        `<div style="display:flex;align-items:center;gap:6px;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:${GRAPH_COLORS[n.type]};font-weight:700"><span style="width:8px;height:8px;border-radius:50%;background:${GRAPH_COLORS[n.type]}"></span>${escapeHtml(typeLabel(n.type))}</div>` +
        `<div style="font-weight:600;margin-top:2px">${escapeHtml(n.label)}</div>` +
        (n.sub
          ? `<div style="opacity:.7;margin-top:1px">${escapeHtml(n.sub)}</div>`
          : "") +
        `<div style="opacity:.6;margin-top:3px">${escapeHtml(linksLabel(n.degree))}</div></div>`
      }
      linkColor={(l) => {
        const on =
          !hover || endId(l.source) === hover || endId(l.target) === hover;
        return dark
          ? on
            ? "rgba(163,163,163,0.45)"
            : "rgba(163,163,163,0.06)"
          : on
            ? "rgba(115,115,115,0.4)"
            : "rgba(115,115,115,0.06)";
      }}
      linkWidth={(l) =>
        hover && (endId(l.source) === hover || endId(l.target) === hover)
          ? 1.6
          : 0.6
      }
      onRenderFramePre={drawRings}
      onNodeHover={(n) => setHover(n ? (n.id as string) : null)}
      onNodeClick={(n) => onOpen(n)}
      onNodeRightClick={(n) => onFocus(n)}
      onNodeDragEnd={(n) => {
        // Keep dragged nodes where the user put them (the centre stays pinned anyway).
        n.fx = n.x;
        n.fy = n.y;
      }}
      cooldownTicks={180}
      d3VelocityDecay={0.3}
      onEngineStop={() => undefined}
    />
  );
}

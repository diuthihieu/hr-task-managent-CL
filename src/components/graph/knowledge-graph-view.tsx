"use client";
// Graph View: toolbar (mode, centre, depth, search, zoom), type filters that
// double as the legend, and the canvas. The graph is fetched once; local mode,
// depth and filters are computed on the client so switching is instant.
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronDown, Globe2, Loader2, Maximize2, Minus, Plus, Search, SlidersHorizontal, Target, X } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { useTheme } from "@/components/theme-provider";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { GRAPH_COLORS, GRAPH_NODE_TYPES, localSubgraph, type GraphNode, type GraphNodeType, type KnowledgeGraph } from "@/lib/knowledge-graph-core";
import type { MessageKey } from "@/lib/i18n/core";
import type { GraphCanvasHandle } from "./graph-canvas";

// react-force-graph needs `window`: render it in the browser only.
const GraphCanvas = dynamic(() => import("./graph-canvas"), { ssr: false, loading: () => <Spinner /> });

function Spinner() {
  return (
    <div className="absolute inset-0 flex items-center justify-center text-neutral-400">
      <Loader2 className="animate-spin" size={22} />
    </div>
  );
}

export function KnowledgeGraphView({ workspaceId, initialFocus, initialMode, embedded }: { workspaceId: string; initialFocus?: string; initialMode?: "global" | "local"; embedded?: boolean }) {
  const { t } = useT();
  const { theme } = useTheme();
  const router = useRouter();
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"global" | "local">(initialMode ?? (initialFocus ? "local" : "global"));
  const [focus, setFocus] = useState<string | undefined>(initialFocus);
  const [depth, setDepth] = useState(2);
  const [hiddenTypes, setHiddenTypes] = useState<Set<GraphNodeType>>(new Set());
  const [hiddenStatuses, setHiddenStatuses] = useState<Set<string>>(new Set());
  const [statusFilterOpen, setStatusFilterOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const canvas = useRef<GraphCanvasHandle>(null);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    api
      .get<KnowledgeGraph>(`/api/workspaces/${workspaceId}/graph`)
      .then(setGraph)
      .catch((e: Error) => setError(e.message));
  }, [workspaceId]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ width: Math.floor(e.contentRect.width), height: Math.floor(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep the URL shareable (?mode=local&focus=wiki:<id>) without a navigation.
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("mode", mode);
    if (mode === "local" && focus) url.searchParams.set("focus", focus);
    else url.searchParams.delete("focus");
    window.history.replaceState(null, "", url);
  }, [mode, focus]);

  const byId = useMemo(() => new Map((graph?.nodes ?? []).map((n) => [n.id, n])), [graph]);
  const centre = focus ? byId.get(focus) : undefined;
  const local = mode === "local" && !!centre;

  const view = useMemo(() => {
    if (!graph) return { nodes: [], links: [] };
    const base = local ? localSubgraph(graph, focus!, depth) : graph;
    const nodes = base.nodes.filter((n) => (!hiddenTypes.has(n.type) && (!n.status || !hiddenStatuses.has(`${n.type}:${n.status}`))) || n.id === focus);
    const keep = new Set(nodes.map((n) => n.id));
    return { nodes, links: base.links.filter((l) => keep.has(l.source) && keep.has(l.target)) };
  }, [graph, local, focus, depth, hiddenStatuses, hiddenTypes]);

  const counts = useMemo(() => {
    const c = Object.fromEntries(GRAPH_NODE_TYPES.map((k) => [k, 0])) as Record<GraphNodeType, number>;
    const src = graph ? (local ? localSubgraph(graph, focus!, depth).nodes : graph.nodes) : [];
    for (const n of src) c[n.type]++;
    return c;
  }, [graph, local, focus, depth]);

  const statusGroups = useMemo(() => {
    const source = graph ? (local ? localSubgraph(graph, focus!, depth).nodes : graph.nodes) : [];
    const grouped = new Map<GraphNodeType, string[]>();
    for (const node of source) {
      if (!node.status || !["task", "project", "objective", "kr"].includes(node.type)) continue;
      const values = grouped.get(node.type) ?? [];
      if (!values.includes(node.status)) values.push(node.status);
      grouped.set(node.type, values);
    }
    return [...grouped.entries()].map(([type, values]) => ({ type, values: values.sort((a, b) => a.localeCompare(b)) }));
  }, [depth, focus, graph, local]);

  // Re-fit whenever the visible set changes (after the simulation had a moment to spread).
  useEffect(() => {
    const id = window.setTimeout(() => canvas.current?.zoomToFit(), 700);
    return () => window.clearTimeout(id);
  }, [view, size.width, size.height]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return view.nodes.filter((n) => n.label.toLowerCase().includes(q)).slice(0, 8);
  }, [query, view]);
  const centreOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = graph?.nodes ?? [];
    return (q ? all.filter((n) => n.label.toLowerCase().includes(q)) : all.filter((n) => n.type === "wiki").concat(all.filter((n) => n.type !== "wiki")))
      .slice(0, 12);
  }, [graph, query]);

  const typeLabel = (k: GraphNodeType) => t(`graph.type.${k}` as MessageKey);
  const makeCentre = (n: GraphNode) => {
    setFocus(n.id);
    setMode("local");
    setPickerOpen(false);
    setQuery("");
  };
  const open = (n: GraphNode) => {
    if (!n.href) return makeCentre(n);
    if (n.type === "file") window.open(n.href, "_blank", "noopener");
    else router.push(n.href);
  };
  const toggleType = (k: GraphNodeType) =>
    setHiddenTypes((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const toggleStatus = (key: string) => setHiddenStatuses((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  const statusLabel = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className={cn("px-4 sm:px-6 pb-3 space-y-3 border-b border-neutral-200/80 dark:border-neutral-800", embedded ? "pt-3" : "pt-5")}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          {embedded ? (
            <p className="text-xs text-neutral-500">{t("graph.subtitle")}</p>
          ) : (
            <div>
              <h1 className="text-[22px] font-bold tracking-tight text-neutral-900 dark:text-neutral-50">{t("graph.title")}</h1>
              <p className="text-sm text-neutral-500 mt-0.5">{t("graph.subtitle")}</p>
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex rounded-lg border border-neutral-200 dark:border-neutral-800 p-0.5 bg-white dark:bg-neutral-900" role="tablist">
              {(["global", "local"] as const).map((m) => (
                <button
                  key={m}
                  role="tab"
                  aria-selected={mode === m}
                  data-testid={`graph-mode-${m}`}
                  onClick={() => {
                    setMode(m);
                    if (m === "local" && !centre) setPickerOpen(true);
                  }}
                  className={cn("h-7 px-3 rounded-md text-xs font-medium inline-flex items-center gap-1.5", mode === m ? "bg-indigo-600 text-white" : "text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800")}
                >
                  {m === "global" ? <Globe2 size={12} /> : <Target size={12} />}
                  {t(`graph.mode.${m}`)}
                </button>
              ))}
            </div>
            {mode === "local" && (
              <>
                <div className="relative">
                  <button
                    data-testid="graph-centre"
                    onClick={() => setPickerOpen((o) => !o)}
                    className="h-8 max-w-[16rem] px-2.5 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-xs inline-flex items-center gap-1.5"
                  >
                    {centre && <span className="h-2 w-2 rounded-full shrink-0" style={{ background: GRAPH_COLORS[centre.type] }} />}
                    <span className="truncate">{centre ? centre.label : t("graph.pickCenter")}</span>
                  </button>
                </div>
                <label className="inline-flex items-center gap-1.5 text-xs text-neutral-500">
                  {t("graph.depth")}
                  <select data-testid="graph-depth" value={depth} onChange={(e) => setDepth(Number(e.target.value))} className="h-8 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-2 text-xs text-neutral-800 dark:text-neutral-200">
                    {[1, 2, 3].map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input
                data-testid="graph-search"
                value={pickerOpen ? "" : query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && matches[0]) {
                    canvas.current?.focusNode(matches[0].id);
                    setQuery("");
                  }
                }}
                placeholder={t("graph.search")}
                className="h-8 w-44 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 pl-7 pr-2 text-xs outline-none focus:border-indigo-400"
              />
              {!pickerOpen && query.trim() && (
                <div className="absolute right-0 top-9 z-20 w-72 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-lg p-1">
                  {matches.length === 0 ? (
                    <p className="px-2 py-1.5 text-xs text-neutral-500">{t("graph.noMatch")}</p>
                  ) : (
                    matches.map((n) => (
                      <NodeOption
                        key={n.id}
                        node={n}
                        typeLabel={typeLabel}
                        onClick={() => {
                          canvas.current?.focusNode(n.id);
                          setQuery("");
                        }}
                      />
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" data-testid="graph-filters">
          {GRAPH_NODE_TYPES.map((k) => {
            const off = hiddenTypes.has(k);
            return (
              <button
                key={k}
                data-testid={`graph-filter-${k}`}
                aria-pressed={!off}
                onClick={() => toggleType(k)}
                className={cn(
                  "h-7 px-2.5 rounded-full border text-xs inline-flex items-center gap-1.5 transition-colors",
                  off ? "border-neutral-200 dark:border-neutral-800 text-neutral-400 line-through" : "border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-200"
                )}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: GRAPH_COLORS[k], opacity: off ? 0.35 : 1 }} />
                {typeLabel(k)}
                <span className="text-neutral-400 tabular-nums">{counts[k]}</span>
              </button>
            );
          })}
          {hiddenTypes.size > 0 && (
            <button onClick={() => setHiddenTypes(new Set())} className="h-7 px-2 text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
              {t("graph.showAll")}
            </button>
          )}
          {statusGroups.length > 0 && <div className="relative ml-auto">
            <button type="button" onClick={() => setStatusFilterOpen((open) => !open)} className={cn("h-7 px-2.5 rounded-lg border text-xs inline-flex items-center gap-1.5 bg-white dark:bg-neutral-900", hiddenStatuses.size ? "border-indigo-400 text-indigo-700 dark:text-indigo-300" : "border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300")} aria-expanded={statusFilterOpen} data-testid="graph-status-filter">
              <SlidersHorizontal size={12} />{t("graph.statusFilter")}{hiddenStatuses.size > 0 && <span className="rounded-full bg-indigo-100 dark:bg-indigo-950 px-1.5 tabular-nums">{hiddenStatuses.size}</span>}<ChevronDown size={11} />
            </button>
            {statusFilterOpen && <div className="absolute right-0 top-9 z-30 w-72 max-h-80 overflow-y-auto rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-lg p-3 space-y-3" data-testid="graph-status-menu">
              <div className="flex items-center justify-between"><span className="text-xs font-semibold">{t("graph.statusFilter")}</span><button type="button" className="text-[11px] text-indigo-600 hover:underline" onClick={() => setHiddenStatuses(new Set())}>{t("graph.showAll")}</button></div>
              {statusGroups.map((group) => <fieldset key={group.type}><legend className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400 mb-1">{typeLabel(group.type)}</legend><div className="space-y-1">{group.values.map((value) => { const key = `${group.type}:${value}`; return <label key={key} className="flex items-center gap-2 text-xs rounded-md px-1 py-1 hover:bg-neutral-50 dark:hover:bg-neutral-800"><input type="checkbox" checked={!hiddenStatuses.has(key)} onChange={() => toggleStatus(key)} className="accent-indigo-600" /><span className="truncate">{statusLabel(value)}</span></label>; })}</div></fieldset>)}
            </div>}
          </div>}
        </div>
      </div>

      <div ref={box} className="relative flex-1 min-h-[22rem] bg-neutral-50/60 dark:bg-neutral-950 overflow-hidden [&_.float-tooltip-kap]:!bg-transparent [&_.float-tooltip-kap]:!p-0" data-testid="graph-canvas">
        {pickerOpen && (
          <div className="absolute left-4 top-3 z-20 w-80 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-lg p-2" data-testid="graph-centre-picker">
            <div className="flex items-center gap-1.5 mb-1">
              <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("graph.pickCenter")} className="h-8 flex-1 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-transparent px-2 text-xs outline-none focus:border-indigo-400" />
              <button
                onClick={() => {
                  setPickerOpen(false);
                  setQuery("");
                }}
                className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800"
                aria-label={t("common.close")}
              >
                <X size={14} />
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto thin-scroll">
              {centreOptions.map((n) => (
                <NodeOption key={n.id} node={n} typeLabel={typeLabel} onClick={() => makeCentre(n)} />
              ))}
              {centreOptions.length === 0 && <p className="px-2 py-1.5 text-xs text-neutral-500">{t("graph.noMatch")}</p>}
            </div>
          </div>
        )}
        {error ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-red-600">{error}</div>
        ) : !graph ? (
          <Spinner />
        ) : view.nodes.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-neutral-500">{mode === "local" && !centre ? t("graph.pickCenter") : t("graph.empty")}</div>
        ) : (
          size.width > 0 && (
            <GraphCanvas
              handleRef={canvas}
              nodes={view.nodes}
              links={view.links}
              width={size.width}
              height={size.height}
              focus={local ? focus : undefined}
              rings={local ? depth : 0}
              dark={theme === "dark"}
              typeLabel={typeLabel}
              linksLabel={(count) => t("graph.links", { count })}
              onOpen={open}
              onFocus={makeCentre}
            />
          )
        )}

        <div className="absolute right-3 top-3 flex flex-col rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white/90 dark:bg-neutral-900/90 shadow-sm overflow-hidden">
          <ZoomButton label={t("graph.zoomIn")} onClick={() => canvas.current?.zoomBy(1.4)} testId="graph-zoom-in">
            <Plus size={14} />
          </ZoomButton>
          <ZoomButton label={t("graph.zoomOut")} onClick={() => canvas.current?.zoomBy(1 / 1.4)} testId="graph-zoom-out">
            <Minus size={14} />
          </ZoomButton>
          <ZoomButton label={t("graph.fit")} onClick={() => canvas.current?.zoomToFit()} testId="graph-fit">
            <Maximize2 size={13} />
          </ZoomButton>
        </div>

        <div className="pointer-events-none absolute left-3 bottom-3 right-3 flex flex-wrap items-end justify-between gap-2 text-[11px] text-neutral-500">
          <span className="rounded-md bg-white/80 dark:bg-neutral-900/80 px-2 py-1" data-testid="graph-stats">
            {t("graph.stats", { nodes: view.nodes.length, links: view.links.length })}
          </span>
          <span className="hidden sm:inline rounded-md bg-white/80 dark:bg-neutral-900/80 px-2 py-1">{t("graph.hint")}</span>
        </div>
        {graph?.truncated && (
          <div className="absolute left-1/2 -translate-x-1/2 top-3 rounded-lg bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-200 text-xs px-3 py-1.5 inline-flex items-center gap-1.5 shadow-sm">
            <AlertTriangle size={12} /> {t("graph.truncated")}
          </div>
        )}
      </div>
    </div>
  );
}

function NodeOption({ node, typeLabel, onClick }: { node: GraphNode; typeLabel: (k: GraphNodeType) => string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center gap-2 text-xs">
      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: GRAPH_COLORS[node.type] }} />
      <span className="min-w-0 flex-1 truncate text-neutral-800 dark:text-neutral-100">{node.label}</span>
      <span className="text-[10px] text-neutral-400 shrink-0">{typeLabel(node.type)}</span>
    </button>
  );
}

function ZoomButton({ label, onClick, children, testId }: { label: string; onClick: () => void; children: React.ReactNode; testId: string }) {
  return (
    <button title={label} aria-label={label} onClick={onClick} data-testid={testId} className="h-8 w-8 inline-flex items-center justify-center text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800">
      {children}
    </button>
  );
}

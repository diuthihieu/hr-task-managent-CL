// Types and pure helpers shared by the graph API and the Graph View (no server imports).

export const GRAPH_NODE_TYPES = ["wiki", "task", "project", "objective", "kr", "person", "tag", "file"] as const;
export type GraphNodeType = (typeof GRAPH_NODE_TYPES)[number];

export interface GraphNode {
  id: string; // "<type>:<uuid>"
  type: GraphNodeType;
  label: string;
  /** Second line for the tooltip (project, status, wiki…). */
  sub?: string;
  /** Where clicking the node goes; none for people (clicking focuses them). */
  href?: string;
  /** Number of links (drives the node size). */
  degree: number;
  /** Local graph only: hops from the centre node. */
  depth?: number;
  done?: boolean;
}
export type GraphLinkKind = "child" | "link" | "project" | "assignee" | "owner" | "contributor" | "tag" | "okr" | "depends" | "subtask" | "file" | "mention" | "author" | "cascade" | "source";
export interface GraphLink {
  source: string;
  target: string;
  kind: GraphLinkKind;
}
export interface KnowledgeGraph {
  nodes: GraphNode[];
  links: GraphLink[];
  /** Set when the graph was capped (very large workspaces). */
  truncated: boolean;
  focus?: string;
}


/** Colour per entity type (fixed, so the legend means the same thing for everyone). */
export const GRAPH_COLORS: Record<GraphNodeType, string> = {
  wiki: "#6366f1",
  task: "#0ea5e9",
  project: "#f97316",
  objective: "#22c55e",
  kr: "#14b8a6",
  person: "#ec4899",
  tag: "#eab308",
  file: "#94a3b8",
};

/** Local graph: the focus node and everything within `depth` hops, each node tagged with its distance. */
export function localSubgraph(graph: KnowledgeGraph, focus: string, depth: number): KnowledgeGraph {
  const adj = new Map<string, string[]>();
  for (const l of graph.links) {
    (adj.get(l.source) ?? adj.set(l.source, []).get(l.source)!).push(l.target);
    (adj.get(l.target) ?? adj.set(l.target, []).get(l.target)!).push(l.source);
  }
  const dist = new Map<string, number>();
  if (!graph.nodes.some((n) => n.id === focus)) return { nodes: [], links: [], truncated: false, focus };
  dist.set(focus, 0);
  let frontier = [focus];
  for (let d = 1; d <= depth && frontier.length; d++) {
    const next: string[] = [];
    for (const id of frontier)
      for (const nb of adj.get(id) ?? [])
        if (!dist.has(nb)) {
          dist.set(nb, d);
          next.push(nb);
        }
    frontier = next;
  }
  const nodes = graph.nodes.filter((n) => dist.has(n.id)).map((n) => ({ ...n, depth: dist.get(n.id)! }));
  const links = graph.links.filter((l) => dist.has(l.source) && dist.has(l.target));
  return { nodes, links, truncated: graph.truncated, focus };
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { localSubgraph, type KnowledgeGraph } from "../knowledge-graph-core";

const n = (id: string) => ({ id, type: "wiki" as const, label: id, degree: 0 });
// a - b - c - d, plus e isolated
const g: KnowledgeGraph = {
  nodes: ["a", "b", "c", "d", "e"].map(n),
  links: [
    { source: "a", target: "b", kind: "link" },
    { source: "c", target: "b", kind: "child" },
    { source: "c", target: "d", kind: "link" },
  ],
  truncated: false,
};

test("localSubgraph tags each node with its hop distance and keeps links inside the set", () => {
  const one = localSubgraph(g, "b", 1);
  assert.deepEqual(Object.fromEntries(one.nodes.map((x) => [x.id, x.depth])), { a: 1, b: 0, c: 1 });
  assert.equal(one.links.length, 2);
  const two = localSubgraph(g, "a", 2);
  assert.deepEqual(two.nodes.map((x) => [x.id, x.depth]), [["a", 0], ["b", 1], ["c", 2]], "links are followed in both directions");
  assert.equal(two.focus, "a");
});

test("localSubgraph of an unknown node is empty", () => {
  assert.deepEqual(localSubgraph(g, "zzz", 2).nodes, []);
});

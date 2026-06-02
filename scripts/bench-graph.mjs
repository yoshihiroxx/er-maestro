#!/usr/bin/env node
// Benchmark the layout/graph pipeline (parser/UI excluded) against a
// pre-generated SchemaModel JSON. Re-implements buildGraph / adjacency /
// BFS / dagre / elk in plain JS so it can run under Node without the
// @xyflow/react front-end stack. The dimensions and layout options match
// `src/graph/*` 1:1 — if you change a parameter there, mirror it here.
//
// Usage:
//   node scripts/bench-graph.mjs --in tmp/bench-200.json [--iters 3] \
//     [--engines dagre-lr,dagre-tb,elk]

import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

import Dagre from "@dagrejs/dagre";
import ELK from "elkjs/lib/elk.bundled.js";

// Mirror of src/graph/buildGraph.ts constants — keep in sync.
const NODE_WIDTH = 264;
const HEADER_HEIGHT = 40;
const ROW_HEIGHT = 26;
const COLUMNS_PADDING = 8;

function nodeHeight(table) {
  return (
    HEADER_HEIGHT +
    Math.max(1, table.columns.length) * ROW_HEIGHT +
    COLUMNS_PADDING
  );
}

function buildGraph(schema) {
  const nodes = schema.tables.map((table) => ({
    id: table.id,
    type: "table",
    position: { x: 0, y: 0 },
    width: NODE_WIDTH,
    height: nodeHeight(table),
    data: { table, state: "normal" },
  }));
  const edges = schema.relationships.map((r) => ({
    id: r.id,
    source: r.from_table,
    target: r.to_table,
  }));
  return { nodes, edges };
}

function buildAdjacency(relationships) {
  const adj = new Map();
  const link = (a, b) => {
    let s = adj.get(a);
    if (!s) {
      s = new Set();
      adj.set(a, s);
    }
    s.add(b);
  };
  for (const r of relationships) {
    link(r.from_table, r.to_table);
    link(r.to_table, r.from_table);
  }
  return adj;
}

function relatedTables(adj, start, depth) {
  const visited = new Set([start]);
  let frontier = [start];
  for (let d = 0; d < depth; d++) {
    const next = [];
    for (const n of frontier) {
      for (const neighbor of adj.get(n) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          next.push(neighbor);
        }
      }
    }
    if (!next.length) break;
    frontier = next;
  }
  return visited;
}

function layoutDagre(nodes, edges, direction) {
  const g = new Dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    nodesep: 48,
    ranksep: 96,
    marginx: 24,
    marginy: 24,
  });
  for (const n of nodes) g.setNode(n.id, { width: n.width, height: n.height });
  for (const e of edges) {
    if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
  }
  Dagre.layout(g);
}

const elk = new ELK();
const ELK_OPTIONS = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.layered.spacing.nodeNodeBetweenLayers": "120",
  "elk.spacing.nodeNode": "60",
  "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
};
async function layoutElk(nodes, edges) {
  if (!nodes.length) return;
  await elk.layout({
    id: "root",
    layoutOptions: ELK_OPTIONS,
    children: nodes.map((n) => ({ id: n.id, width: n.width, height: n.height })),
    edges: edges
      .filter((e) => e.source !== e.target)
      .map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  });
}

function parseArgs(argv) {
  const out = {
    in: null,
    iters: 3,
    engines: ["dagre-lr", "dagre-tb", "elk"],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eat = () => argv[++i];
    if (a === "--in") out.in = eat();
    else if (a === "--iters") out.iters = Number(eat());
    else if (a === "--engines") out.engines = eat().split(",").map((s) => s.trim());
    else if (a === "-h" || a === "--help") {
      console.log("bench-graph --in path --iters N --engines dagre-lr,dagre-tb,elk");
      process.exit(0);
    }
  }
  if (!out.in) {
    console.error("--in <schema.json> is required");
    process.exit(1);
  }
  return out;
}

async function timeAsync(fn) {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

function time(fn) {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

function summary(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = samples.reduce((a, b) => a + b, 0);
  return {
    min: sorted[0],
    median: sorted[Math.floor(sorted.length / 2)],
    mean: sum / samples.length,
    max: sorted[sorted.length - 1],
  };
}

function fmt(n) {
  return n.toFixed(1).padStart(8) + " ms";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const schema = JSON.parse(readFileSync(args.in, "utf8"));
  console.log(
    `input: ${args.in} — ${schema.tables.length} tables, ${schema.relationships.length} rels`,
  );

  const phases = {
    buildGraph: [],
    adjacency: [],
    "BFS depth=1 from each table": [],
  };
  for (const e of args.engines) phases[`layout:${e}`] = [];

  for (let i = 0; i < args.iters; i++) {
    let nodes, edges, adj;
    phases.buildGraph.push(
      time(() => {
        const g = buildGraph(schema);
        nodes = g.nodes;
        edges = g.edges;
      }),
    );
    phases.adjacency.push(
      time(() => {
        adj = buildAdjacency(schema.relationships);
      }),
    );
    phases["BFS depth=1 from each table"].push(
      time(() => {
        for (const t of schema.tables) relatedTables(adj, t.id, 1);
      }),
    );
    for (const eng of args.engines) {
      let ms;
      if (eng === "elk") {
        ms = await timeAsync(() => layoutElk(nodes, edges));
      } else {
        const dir = eng === "dagre-tb" ? "TB" : "LR";
        ms = time(() => layoutDagre(nodes, edges, dir));
      }
      phases[`layout:${eng}`].push(ms);
    }
  }

  console.log(`\nphase                            ${"min".padStart(8)}  ${"median".padStart(8)}  ${"mean".padStart(8)}  ${"max".padStart(8)}`);
  console.log("-".repeat(74));
  for (const [name, samples] of Object.entries(phases)) {
    const s = summary(samples);
    console.log(
      `${name.padEnd(32)} ${fmt(s.min)}  ${fmt(s.median)}  ${fmt(s.mean)}  ${fmt(s.max)}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

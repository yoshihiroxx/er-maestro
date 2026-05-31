import Dagre from "@dagrejs/dagre";
import type { Edge } from "@xyflow/react";
import { NODE_WIDTH, nodeHeight, type TableNode } from "../buildGraph";

export type DagreDirection = "LR" | "TB";

/** Synchronous layered layout via dagre. Node sizes come from our estimates
 *  (which match the rendered CSS), so no measure pass is needed. */
export function layoutDagre(
  nodes: TableNode[],
  edges: Edge[],
  direction: DagreDirection,
): TableNode[] {
  const g = new Dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    nodesep: 48,
    ranksep: 96,
    marginx: 24,
    marginy: 24,
  });

  for (const n of nodes) {
    g.setNode(n.id, {
      width: n.width ?? NODE_WIDTH,
      height: n.height ?? nodeHeight(n.data.table),
    });
  }
  for (const e of edges) {
    if (g.hasNode(e.source) && g.hasNode(e.target)) {
      g.setEdge(e.source, e.target);
    }
  }

  Dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(n.id);
    const w = n.width ?? NODE_WIDTH;
    const h = n.height ?? nodeHeight(n.data.table);
    // dagre reports node centers; React Flow positions are top-left.
    return { ...n, position: { x: pos.x - w / 2, y: pos.y - h / 2 } };
  });
}

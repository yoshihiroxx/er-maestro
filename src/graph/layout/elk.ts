import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import type { Edge } from "@xyflow/react";
import { NODE_WIDTH, nodeHeight, type TableNode } from "../buildGraph";

const elk = new ELK();

const LAYOUT_OPTIONS: Record<string, string> = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.layered.spacing.nodeNodeBetweenLayers": "120",
  "elk.spacing.nodeNode": "60",
  "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
};

/**
 * Layered, orthogonal layout via ELK. Asynchronous; node sizes come from our
 * estimates. Edges are returned unchanged (we keep React Flow's own routing).
 */
export async function layoutElk(
  nodes: TableNode[],
  edges: Edge[],
): Promise<TableNode[]> {
  if (nodes.length === 0) return nodes;

  const graph: ElkNode = {
    id: "root",
    layoutOptions: LAYOUT_OPTIONS,
    children: nodes.map((n) => ({
      id: n.id,
      width: n.width ?? NODE_WIDTH,
      height: n.height ?? nodeHeight(n.data.table),
    })),
    edges: edges
      .filter((e) => e.source !== e.target)
      .map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };

  const laidOut = await elk.layout(graph);
  const positions = new Map<string, { x: number; y: number }>();
  for (const child of laidOut.children ?? []) {
    positions.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
  }

  return nodes.map((n) => ({
    ...n,
    position: positions.get(n.id) ?? n.position,
  }));
}

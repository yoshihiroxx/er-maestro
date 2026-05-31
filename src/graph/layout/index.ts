import type { Edge } from "@xyflow/react";
import type { LayoutKind } from "../../store/schemaStore";
import type { TableNode } from "../buildGraph";
import { layoutDagre } from "./dagre";
import { layoutElk } from "./elk";

/** Run the selected layout engine and return positioned nodes. */
export async function runLayout(
  kind: LayoutKind,
  nodes: TableNode[],
  edges: Edge[],
): Promise<TableNode[]> {
  switch (kind) {
    case "elk":
      return layoutElk(nodes, edges);
    case "dagre-tb":
      return layoutDagre(nodes, edges, "TB");
    case "dagre-lr":
    default:
      return layoutDagre(nodes, edges, "LR");
  }
}

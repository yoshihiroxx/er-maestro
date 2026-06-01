import type { Edge, Node } from "@xyflow/react";
import { MarkerType } from "@xyflow/react";
import type { SchemaModel, Table } from "../types";

export const NODE_WIDTH = 264;
export const HEADER_HEIGHT = 40;
export const ROW_HEIGHT = 26;
export const COLUMNS_PADDING = 8;

/** Visual emphasis applied to a node based on the current selection. */
export type NodeState = "normal" | "selected" | "related" | "dimmed";

export type TableNodeData = {
  table: Table;
  state: NodeState;
  /** Column name that is the active focus (hovered or pinned) on this node, if any. */
  activeColumnName: string | null;
  /** Column names highlighted as the other side of an FK involving the active column. */
  relatedColumnNames: ReadonlySet<string>;
  [key: string]: unknown;
};

export type TableNode = Node<TableNodeData, "table">;

const EMPTY_COLUMN_SET: ReadonlySet<string> = new Set<string>();

/** Estimated node height; the CSS uses these exact row/header sizes so the
 *  rendered node matches what the layout engine was given (no measure pass). */
export function nodeHeight(table: Table): number {
  const visibleRows = table.kind === "view" ? table.columns.length : Math.max(1, table.columns.length);
  return (
    HEADER_HEIGHT + visibleRows * ROW_HEIGHT + COLUMNS_PADDING
  );
}

export type BuildGraphOptions = {
  includeInferred?: boolean;
};

/** Convert a parsed schema into React Flow nodes + edges (unpositioned). */
export function buildGraph(
  schema: SchemaModel,
  options: BuildGraphOptions = {},
): {
  nodes: TableNode[];
  edges: Edge[];
} {
  const { includeInferred = true } = options;

  const nodes: TableNode[] = schema.tables.map((table) => ({
    id: table.id,
    type: "table",
    position: { x: 0, y: 0 },
    width: NODE_WIDTH,
    height: nodeHeight(table),
    data: {
      table,
      state: "normal",
      activeColumnName: null,
      relatedColumnNames: EMPTY_COLUMN_SET,
    },
  }));

  const edges: Edge[] = schema.relationships
    .filter((r) => includeInferred || !r.inferred)
    .map((r) => {
      const fromCol = r.from_columns[0];
      const toCol = r.to_columns[0];
      return {
        id: r.id,
        source: r.from_table,
        target: r.to_table,
        sourceHandle: fromCol ? `s-${fromCol}` : undefined,
        targetHandle: toCol ? `t-${toCol}` : undefined,
        type: "smoothstep",
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        className:
          r.via === "view_dependency"
            ? "edge--view-dependency"
            : r.inferred
              ? "edge--inferred"
              : undefined,
        data: { relationship: r },
      };
    });

  return { nodes, edges };
}

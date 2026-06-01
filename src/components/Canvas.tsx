import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useSchemaStore } from "../store/schemaStore";
import { buildGraph, type NodeState, type TableNode as TNode } from "../graph/buildGraph";
import { buildAdjacency, relatedTables } from "../graph/neighbors";
import { runLayout } from "../graph/layout";
import { TableNode } from "./TableNode";

// Defined at module scope so the reference is stable across renders
// (inline objects would remount every node and spam a console warning).
const nodeTypes = { table: TableNode };
const EMPTY_COLUMN_SET: ReadonlySet<string> = new Set<string>();

export function Canvas() {
  const schema = useSchemaStore((s) => s.schema);
  const selectedTableId = useSchemaStore((s) => s.selectedTableId);
  const hoveredColumn = useSchemaStore((s) => s.hoveredColumn);
  const pinnedColumn = useSchemaStore((s) => s.pinnedColumn);
  const focusMode = useSchemaStore((s) => s.focusMode);
  const focusDepth = useSchemaStore((s) => s.focusDepth);
  const layoutKind = useSchemaStore((s) => s.layoutKind);
  const selectTable = useSchemaStore((s) => s.selectTable);
  const clearSelection = useSchemaStore((s) => s.clearSelection);

  const { fitView } = useReactFlow();

  const base = useMemo(
    () => (schema ? buildGraph(schema) : { nodes: [], edges: [] }),
    [schema],
  );
  const adjacency = useMemo(
    () => buildAdjacency(schema?.relationships ?? []),
    [schema],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<TNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const layoutToken = useRef(0);

  // Re-run layout whenever the graph or chosen algorithm changes.
  useEffect(() => {
    const token = ++layoutToken.current;
    let cancelled = false;
    runLayout(layoutKind, base.nodes, base.edges).then((positioned) => {
      if (cancelled || token !== layoutToken.current) return;
      setNodes(positioned);
      setEdges(base.edges);
      requestAnimationFrame(() => fitView({ padding: 0.2, duration: 300 }));
    });
    return () => {
      cancelled = true;
    };
  }, [base, layoutKind, setNodes, setEdges, fitView]);

  // The set of tables to keep visible / highlighted given the selection.
  const related = useMemo(() => {
    if (!selectedTableId) return null;
    return relatedTables(adjacency, selectedTableId, focusDepth);
  }, [adjacency, selectedTableId, focusDepth]);

  // Pinned takes precedence over hovered so that clicking locks the focus
  // even as the cursor leaves the row.
  const activeColumn = pinnedColumn ?? hoveredColumn;

  // For the active column, pre-compute which edges connect it and which
  // columns on the *other* side of each FK should light up.
  const { relatedByTable, activeEdgeIds } = useMemo(() => {
    const byTable = new Map<string, Set<string>>();
    const edgeIds = new Set<string>();
    if (!activeColumn || !schema) {
      return { relatedByTable: byTable, activeEdgeIds: edgeIds };
    }
    for (const r of schema.relationships) {
      const fromSide =
        r.from_table === activeColumn.tableId &&
        r.from_columns.includes(activeColumn.columnName);
      const toSide =
        r.to_table === activeColumn.tableId &&
        r.to_columns.includes(activeColumn.columnName);
      if (!fromSide && !toSide) continue;
      edgeIds.add(r.id);
      const otherTable = fromSide ? r.to_table : r.from_table;
      const otherCols = fromSide ? r.to_columns : r.from_columns;
      let set = byTable.get(otherTable);
      if (!set) {
        set = new Set<string>();
        byTable.set(otherTable, set);
      }
      for (const c of otherCols) set.add(c);
    }
    return { relatedByTable: byTable, activeEdgeIds: edgeIds };
  }, [activeColumn, schema]);

  const displayNodes = useMemo<TNode[]>(() => {
    return nodes.map((n) => {
      let state: NodeState = "normal";
      let hidden = false;
      if (related) {
        if (n.id === selectedTableId) state = "selected";
        else if (related.has(n.id)) state = "related";
        else {
          state = "dimmed";
          hidden = focusMode;
        }
      }
      const nodeActiveColumnName =
        activeColumn && activeColumn.tableId === n.id
          ? activeColumn.columnName
          : null;
      const nodeRelatedColumns = relatedByTable.get(n.id) ?? EMPTY_COLUMN_SET;
      return {
        ...n,
        hidden,
        data: {
          ...n.data,
          state,
          activeColumnName: nodeActiveColumnName,
          relatedColumnNames: nodeRelatedColumns,
        },
      };
    });
  }, [nodes, related, selectedTableId, focusMode, activeColumn, relatedByTable]);

  const displayEdges = useMemo<Edge[]>(() => {
    const hasActiveColumn = activeColumn !== null;
    return edges.map((e) => {
      const isColumnActive = activeEdgeIds.has(e.id);
      if (!related) {
        if (!hasActiveColumn) return { ...e, hidden: false, className: undefined };
        return {
          ...e,
          hidden: false,
          className: isColumnActive ? "edge--column-active" : "edge--column-dim",
        };
      }
      const active = related.has(e.source) && related.has(e.target);
      let className: string | undefined;
      if (hasActiveColumn) {
        className = isColumnActive
          ? "edge--column-active"
          : active
          ? "edge--column-dim"
          : "edge--dim";
      } else {
        className = active ? "edge--active" : "edge--dim";
      }
      return {
        ...e,
        hidden: focusMode ? !active : false,
        className,
      };
    });
  }, [edges, related, focusMode, activeColumn, activeEdgeIds]);

  // Re-fit when the focus selection changes (visible set shrinks/grows).
  useEffect(() => {
    if (nodes.length === 0) return;
    const id = requestAnimationFrame(() => fitView({ padding: 0.2, duration: 300 }));
    return () => cancelAnimationFrame(id);
  }, [selectedTableId, focusMode, focusDepth, fitView, nodes.length]);

  const onNodeClick = useCallback<NodeMouseHandler>(
    (_event, node) => selectTable(node.id),
    [selectTable],
  );
  const onPaneClick = useCallback(() => clearSelection(), [clearSelection]);

  return (
    <ReactFlow
      nodes={displayNodes}
      edges={displayEdges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={onNodeClick}
      onPaneClick={onPaneClick}
      nodeTypes={nodeTypes}
      nodesConnectable={false}
      elementsSelectable
      onlyRenderVisibleElements
      minZoom={0.05}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      fitView
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable nodeStrokeWidth={2} />
    </ReactFlow>
  );
}

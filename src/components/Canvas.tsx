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

export function Canvas() {
  const schema = useSchemaStore((s) => s.schema);
  const selectedTableId = useSchemaStore((s) => s.selectedTableId);
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
      return { ...n, hidden, data: { ...n.data, state } };
    });
  }, [nodes, related, selectedTableId, focusMode]);

  const displayEdges = useMemo<Edge[]>(() => {
    return edges.map((e) => {
      if (!related) return { ...e, hidden: false, className: undefined };
      const active = related.has(e.source) && related.has(e.target);
      return {
        ...e,
        hidden: focusMode ? !active : false,
        className: active ? "edge--active" : "edge--dim",
      };
    });
  }, [edges, related, focusMode]);

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

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
import { KeyboardShortcuts } from "./KeyboardShortcuts";

// Defined at module scope so the reference is stable across renders
// (inline objects would remount every node and spam a console warning).
const nodeTypes = { table: TableNode };

export function Canvas() {
  const schema = useSchemaStore((s) => s.schema);
  const selectedTableId = useSchemaStore((s) => s.selectedTableId);
  const focusMode = useSchemaStore((s) => s.focusMode);
  const focusDepth = useSchemaStore((s) => s.focusDepth);
  const layoutKind = useSchemaStore((s) => s.layoutKind);
  const inferenceEnabled = useSchemaStore((s) => s.inferenceEnabled);
  const selectTable = useSchemaStore((s) => s.selectTable);
  const clearSelection = useSchemaStore((s) => s.clearSelection);
  const jumpToken = useSchemaStore((s) => s.jumpToken);

  const { fitView, setCenter } = useReactFlow();

  const base = useMemo(
    () =>
      schema
        ? buildGraph(schema, { includeInferred: inferenceEnabled })
        : { nodes: [], edges: [] },
    [schema, inferenceEnabled],
  );
  const adjacency = useMemo(
    () =>
      buildAdjacency(
        (schema?.relationships ?? []).filter(
          (r) => inferenceEnabled || !r.inferred,
        ),
      ),
    [schema, inferenceEnabled],
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

  // Reuse the same node/edge object when nothing relevant changed. React
  // Flow diffs nodes by reference, and TableNode is memoized on `data`, so
  // keeping references stable for unaffected tables means selection toggles
  // re-render only the few nodes whose state actually flipped — a noticeable
  // win on multi-hundred-table schemas (see scripts/bench-graph.mjs).
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
      if (n.data.state === state && (n.hidden ?? false) === hidden) return n;
      return { ...n, hidden, data: { ...n.data, state } };
    });
  }, [nodes, related, selectedTableId, focusMode]);

  const displayEdges = useMemo<Edge[]>(() => {
    return edges.map((e) => {
      let hidden = false;
      const baseClassName = e.className;
      let className = baseClassName;
      if (related) {
        const active = related.has(e.source) && related.has(e.target);
        hidden = focusMode ? !active : false;
        className = [baseClassName, active ? "edge--active" : "edge--dim"]
          .filter(Boolean)
          .join(" ");
      }
      if ((e.hidden ?? false) === hidden && e.className === className) return e;
      return { ...e, hidden, className };
    });
  }, [edges, related, focusMode]);

  // Re-fit when the focus selection changes (visible set shrinks/grows).
  // Skipped on the render where `jumpToken` advanced, so that the explicit
  // search-jump effect below can center on a specific node without being
  // immediately overwritten by fitView.
  const fittedJumpToken = useRef(jumpToken);
  useEffect(() => {
    if (nodes.length === 0) return;
    if (fittedJumpToken.current !== jumpToken) {
      fittedJumpToken.current = jumpToken;
      return;
    }
    const id = requestAnimationFrame(() => fitView({ padding: 0.2, duration: 300 }));
    return () => cancelAnimationFrame(id);
  }, [selectedTableId, focusMode, focusDepth, fitView, nodes.length, jumpToken]);

  // Search → Enter → center the viewport on the selected table.
  useEffect(() => {
    if (jumpToken === 0 || !selectedTableId) return;
    const node = nodes.find((n) => n.id === selectedTableId);
    if (!node) return;
    const w = node.measured?.width ?? node.width ?? 240;
    const h = node.measured?.height ?? node.height ?? 80;
    const cx = node.position.x + w / 2;
    const cy = node.position.y + h / 2;
    const id = requestAnimationFrame(() =>
      setCenter(cx, cy, { zoom: 1.0, duration: 400 }),
    );
    return () => cancelAnimationFrame(id);
  }, [jumpToken, selectedTableId, nodes, setCenter]);

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
      <KeyboardShortcuts />
    </ReactFlow>
  );
}

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  ControlButton,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type NodeMouseHandler,
  type Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useSchemaStore } from "../store/schemaStore";
import {
  buildGraph,
  type NodeState,
  type TableNode as TNode,
} from "../graph/buildGraph";
import { buildAdjacency, relatedTables } from "../graph/neighbors";
import { runLayout } from "../graph/layout";
import type { Relationship, RelationshipCardinality } from "../types";
import { ExportPanel } from "./ExportPanel";
import { TableNode } from "./TableNode";
import { KeyboardShortcuts } from "./KeyboardShortcuts";

// Defined at module scope so the reference is stable across renders
// (inline objects would remount every node and spam a console warning).
const nodeTypes = { table: TableNode };
const edgeTypes = { horizontalBezier: HorizontalBezierEdge };
const EMPTY_COLUMN_SET: ReadonlySet<string> = new Set<string>();
const EDGE_COLOR_ACCENT = "#2563eb";
const EDGE_COLOR_DEFAULT = "#b1b7c3";
const EDGE_COLOR_VIEW = "#047857";
const BEZIER_STUB_LENGTH = 16;
type MarkerEndObject = Extract<NonNullable<Edge["markerEnd"]>, object>;

type HorizontalBezierEdgeProps = {
  id: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
  markerStart?: string;
  markerEnd?: string;
  style?: CSSProperties;
  interactionWidth?: number;
};

function positionVector(position: Position): { x: number; y: number } {
  switch (position) {
    case "left":
      return { x: -1, y: 0 };
    case "right":
      return { x: 1, y: 0 };
    case "top":
      return { x: 0, y: -1 };
    case "bottom":
      return { x: 0, y: 1 };
    default:
      return { x: 1, y: 0 };
  }
}

function HorizontalBezierEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerStart,
  markerEnd,
  style,
  interactionWidth,
}: HorizontalBezierEdgeProps) {
  const sourceVector = positionVector(sourcePosition);
  const targetVector = positionVector(targetPosition);
  const sourceStubX = sourceX + sourceVector.x * BEZIER_STUB_LENGTH;
  const sourceStubY = sourceY + sourceVector.y * BEZIER_STUB_LENGTH;
  const targetStubX = targetX + targetVector.x * BEZIER_STUB_LENGTH;
  const targetStubY = targetY + targetVector.y * BEZIER_STUB_LENGTH;
  const controlGap = Math.max(
    40,
    Math.min(160, Math.abs(targetStubX - sourceStubX) / 2),
  );
  const sourceControlX = sourceStubX + sourceVector.x * controlGap;
  const sourceControlY = sourceStubY + sourceVector.y * controlGap;
  const targetControlX = targetStubX + targetVector.x * controlGap;
  const targetControlY = targetStubY + targetVector.y * controlGap;
  const path = [
    `M ${sourceX},${sourceY}`,
    `L ${sourceStubX},${sourceStubY}`,
    `C ${sourceControlX},${sourceControlY} ${targetControlX},${targetControlY} ${targetStubX},${targetStubY}`,
    `L ${targetX},${targetY}`,
  ].join(" ");

  return (
    <BaseEdge
      id={id}
      path={path}
      markerStart={markerStart}
      markerEnd={markerEnd}
      style={style}
      interactionWidth={interactionWidth}
    />
  );
}

function edgeRelationship(edge: Edge): Relationship | undefined {
  return (edge.data as { relationship?: Relationship } | undefined)
    ?.relationship;
}

function relationshipEdgeClass(edge: Edge): string | null {
  const relationship = edgeRelationship(edge);

  if (relationship?.via === "view_dependency") return "edge--view-dependency";
  if (relationship?.inferred) return "edge--inferred";
  return null;
}

function edgeClassName(
  ...classes: Array<string | null | undefined>
): string | undefined {
  const className = classes.filter(Boolean).join(" ");
  return className || undefined;
}

function edgeColorForClassName(
  className: string | undefined,
): string | undefined {
  if (!className) return EDGE_COLOR_DEFAULT;
  if (className.includes("edge--column-active")) return EDGE_COLOR_ACCENT;
  if (className.includes("edge--view-dependency")) return EDGE_COLOR_VIEW;
  if (className.includes("edge--active")) return EDGE_COLOR_ACCENT;
  return EDGE_COLOR_DEFAULT;
}

function crowMarkerTone(className: string | undefined): "accent" | "default" {
  return edgeColorForClassName(className) === EDGE_COLOR_ACCENT
    ? "accent"
    : "default";
}

function crowMarkerId(
  cardinality: RelationshipCardinality | null | undefined,
  tone: "accent" | "default",
): string | undefined {
  if (!cardinality) return undefined;
  return `crow-${cardinality}-${tone}`;
}

function coloredMarkerEnd(
  edge: Edge,
  color: string | undefined,
): Edge["markerEnd"] {
  if (!color) return edge.markerEnd;
  const base: Partial<MarkerEndObject> =
    typeof edge.markerEnd === "object" && edge.markerEnd !== null
      ? edge.markerEnd
      : {};
  return {
    ...base,
    type: base.type ?? MarkerType.ArrowClosed,
    color,
  };
}

function edgeMarkersForRelationship(
  edge: Edge,
  className: string | undefined,
): Pick<Edge, "markerStart" | "markerEnd"> {
  const relationship = edgeRelationship(edge);
  if (relationship?.via !== "foreign_key" || relationship.inferred) {
    return {
      markerStart: undefined,
      markerEnd: coloredMarkerEnd(edge, edgeColorForClassName(className)),
    };
  }
  const tone = crowMarkerTone(className);
  return {
    markerStart: crowMarkerId(relationship.from_cardinality, tone),
    markerEnd: crowMarkerId(relationship.to_cardinality, tone),
  };
}

function CrowFootMarkers() {
  const tones = [
    { name: "default", color: EDGE_COLOR_DEFAULT },
    { name: "accent", color: EDGE_COLOR_ACCENT },
  ] as const;
  const cardinalities: RelationshipCardinality[] = [
    "one",
    "zero_or_one",
    "one_or_many",
    "zero_or_many",
  ];

  return (
    <svg aria-hidden="true" className="crow-markers">
      <defs>
        {tones.flatMap(({ name, color }) =>
          cardinalities.map((cardinality) => (
            <marker
              key={`${cardinality}-${name}`}
              id={`crow-${cardinality}-${name}`}
              viewBox="-10 -10 20 20"
              refX="6"
              refY="0"
              markerWidth="14"
              markerHeight="14"
              markerUnits="strokeWidth"
              orient="auto-start-reverse"
            >
              <g
                fill="none"
                stroke={color}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.45"
              >
                {cardinality === "zero_or_one" ||
                cardinality === "zero_or_many" ? (
                  <circle cx="-5" cy="0" r="2.6" />
                ) : null}
                {cardinality === "one" ||
                cardinality === "zero_or_one" ||
                cardinality === "one_or_many" ? (
                  <line x1="-1" y1="-5.2" x2="-1" y2="5.2" />
                ) : null}
                {cardinality === "one_or_many" ||
                cardinality === "zero_or_many" ? (
                  <>
                    <line x1="2" y1="0" x2="7.5" y2="-5.2" />
                    <line x1="2" y1="0" x2="8" y2="0" />
                    <line x1="2" y1="0" x2="7.5" y2="5.2" />
                  </>
                ) : null}
              </g>
            </marker>
          )),
        )}
      </defs>
    </svg>
  );
}

export function Canvas() {
  const schema = useSchemaStore((s) => s.schema);
  const selectedTableId = useSchemaStore((s) => s.selectedTableId);
  const hoveredColumn = useSchemaStore((s) => s.hoveredColumn);
  const pinnedColumn = useSchemaStore((s) => s.pinnedColumn);
  const focusMode = useSchemaStore((s) => s.focusMode);
  const focusDepth = useSchemaStore((s) => s.focusDepth);
  const layoutKind = useSchemaStore((s) => s.layoutKind);
  const edgeKind = useSchemaStore((s) => s.edgeKind);
  const inferenceEnabled = useSchemaStore((s) => s.inferenceEnabled);
  const autoFitOnScope = useSchemaStore((s) => s.autoFitOnScope);
  const selectTable = useSchemaStore((s) => s.selectTable);
  const clearSelection = useSchemaStore((s) => s.clearSelection);
  const setAutoFitOnScope = useSchemaStore((s) => s.setAutoFitOnScope);
  const jumpToken = useSchemaStore((s) => s.jumpToken);

  const { fitView, setCenter } = useReactFlow();

  const base = useMemo(() => {
    if (!schema) return { nodes: [], edges: [] };
    const graph = buildGraph(schema, { includeInferred: inferenceEnabled });
    return {
      nodes: graph.nodes,
      edges: graph.edges.map((edge) => ({
        ...edge,
        type: edgeKind === "simplebezier" ? "horizontalBezier" : edgeKind,
      })),
    };
  }, [schema, inferenceEnabled, edgeKind]);
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
  const [fullLayoutNodes, setFullLayoutNodes] = useState<TNode[]>([]);
  const layoutToken = useRef(0);
  const focusLayoutToken = useRef(0);

  // Re-run layout whenever the graph or chosen algorithm changes.
  useEffect(() => {
    const token = ++layoutToken.current;
    let cancelled = false;
    runLayout(layoutKind, base.nodes, base.edges).then((positioned) => {
      if (cancelled || token !== layoutToken.current) return;
      setFullLayoutNodes(positioned);
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

  const visibleTableIds = useMemo(() => {
    if (!selectedTableId || !focusMode) return null;
    return related;
  }, [selectedTableId, focusMode, related]);

  // When focus mode hides unrelated tables, lay out the visible subgraph by
  // itself. That keeps filtered/selected relationships close together instead
  // of preserving their far-apart coordinates from the full 700-table graph.
  useEffect(() => {
    const token = ++focusLayoutToken.current;
    if (!visibleTableIds) {
      setNodes(fullLayoutNodes);
      return;
    }
    if (fullLayoutNodes.length === 0) return;

    const focusNodes = fullLayoutNodes.filter((node) =>
      visibleTableIds.has(node.id),
    );
    const focusEdges = base.edges.filter(
      (edge) =>
        visibleTableIds.has(edge.source) && visibleTableIds.has(edge.target),
    );
    let cancelled = false;
    runLayout(layoutKind, focusNodes, focusEdges).then(
      (positionedFocusNodes) => {
        if (cancelled || token !== focusLayoutToken.current) return;
        const positions = new Map(
          positionedFocusNodes.map((node) => [node.id, node.position]),
        );
        setNodes(
          fullLayoutNodes.map((node) => {
            const position = positions.get(node.id);
            return position ? { ...node, position } : node;
          }),
        );
        if (useSchemaStore.getState().autoFitOnScope) {
          requestAnimationFrame(() => fitView({ padding: 0.2, duration: 300 }));
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [
    visibleTableIds,
    fullLayoutNodes,
    base.edges,
    layoutKind,
    setNodes,
    fitView,
  ]);

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
      const nodeActiveColumnName =
        activeColumn && activeColumn.tableId === n.id
          ? activeColumn.columnName
          : null;
      const nodeRelatedColumns = relatedByTable.get(n.id) ?? EMPTY_COLUMN_SET;
      if (
        n.data.state === state &&
        (n.hidden ?? false) === hidden &&
        n.data.activeColumnName === nodeActiveColumnName &&
        n.data.relatedColumnNames === nodeRelatedColumns
      ) {
        return n;
      }
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
  }, [
    nodes,
    related,
    selectedTableId,
    focusMode,
    activeColumn,
    relatedByTable,
  ]);

  const displayEdges = useMemo<Edge[]>(() => {
    const hasActiveColumn = activeColumn !== null;
    return edges.map((e) => {
      const isColumnActive = activeEdgeIds.has(e.id);
      let hidden = false;
      let stateClassName: string | undefined;
      if (!related) {
        if (hasActiveColumn) {
          stateClassName = isColumnActive
            ? "edge--column-active"
            : "edge--column-dim";
        }
      } else {
        const active = related.has(e.source) && related.has(e.target);
        hidden = focusMode ? !active : false;
        if (hasActiveColumn) {
          stateClassName = isColumnActive
            ? "edge--column-active"
            : active
              ? "edge--column-dim"
              : "edge--dim";
        } else {
          stateClassName = active ? "edge--active" : "edge--dim";
        }
      }
      const className = edgeClassName(relationshipEdgeClass(e), stateClassName);
      const { markerStart, markerEnd } = edgeMarkersForRelationship(
        e,
        className,
      );
      if (
        (e.hidden ?? false) === hidden &&
        e.className === className &&
        e.markerStart === markerStart &&
        e.markerEnd === markerEnd
      ) {
        return e;
      }
      return { ...e, hidden, className, markerStart, markerEnd };
    });
  }, [edges, related, focusMode, activeColumn, activeEdgeIds]);

  // Re-fit when the focus selection changes (visible set shrinks/grows), but
  // only while the user opts into scope auto-fit. Schema load/layout changes
  // still fit in the layout effect above, and search jumps still center below.
  // Skipped on the render where `jumpToken` advanced, so that the explicit
  // search-jump effect below can center on a specific node without being
  // immediately overwritten by fitView.
  const fittedJumpToken = useRef(jumpToken);
  useEffect(() => {
    if (nodes.length === 0) return;
    if (visibleTableIds) return;
    if (fittedJumpToken.current !== jumpToken) {
      fittedJumpToken.current = jumpToken;
      return;
    }
    if (!useSchemaStore.getState().autoFitOnScope) return;
    const id = requestAnimationFrame(() =>
      fitView({ padding: 0.2, duration: 300 }),
    );
    return () => cancelAnimationFrame(id);
  }, [
    selectedTableId,
    focusMode,
    focusDepth,
    fitView,
    nodes.length,
    jumpToken,
    visibleTableIds,
  ]);

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
      edgeTypes={edgeTypes}
      nodesConnectable={false}
      elementsSelectable
      onlyRenderVisibleElements
      minZoom={0.05}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      fitView
    >
      <CrowFootMarkers />
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
      <Controls showInteractive={false}>
        <ControlButton
          onClick={() => setAutoFitOnScope(!autoFitOnScope)}
          className={`autofit-toggle ${
            autoFitOnScope ? "autofit-toggle--on" : "autofit-toggle--off"
          }`}
          title={
            autoFitOnScope
              ? "スコープ切替時に自動フィット: ON"
              : "スコープ切替時に自動フィット: OFF"
          }
          aria-label={
            autoFitOnScope
              ? "スコープ切替時に自動フィット: ON"
              : "スコープ切替時に自動フィット: OFF"
          }
          aria-pressed={autoFitOnScope}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" />
            {!autoFitOnScope ? <line x1="5" y1="5" x2="19" y2="19" /> : null}
          </svg>
        </ControlButton>
      </Controls>
      <ExportPanel />
      <MiniMap pannable zoomable nodeStrokeWidth={2} />
      <KeyboardShortcuts />
    </ReactFlow>
  );
}

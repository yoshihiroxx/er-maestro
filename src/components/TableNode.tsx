import { memo, useCallback } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  HEADER_HEIGHT,
  ROW_HEIGHT,
  type TableNodeData,
} from "../graph/buildGraph";
import { useSchemaStore } from "../store/schemaStore";

function TableNodeComponent({ id, data }: NodeProps) {
  const { table, state, activeColumnName, relatedColumnNames } =
    data as TableNodeData;
  const setHoveredColumn = useSchemaStore((s) => s.setHoveredColumn);
  const togglePinnedColumn = useSchemaStore((s) => s.togglePinnedColumn);

  const handleColumnEnter = useCallback(
    (columnName: string) =>
      setHoveredColumn({ tableId: id, columnName }),
    [id, setHoveredColumn],
  );
  const handleColumnLeave = useCallback(
    () => setHoveredColumn(null),
    [setHoveredColumn],
  );
  const handleColumnClick = useCallback(
    (event: React.MouseEvent, columnName: string) => {
      // Don't bubble to onNodeClick (which selects the whole table).
      event.stopPropagation();
      togglePinnedColumn({ tableId: id, columnName });
    },
    [id, togglePinnedColumn],
  );

  const classes = [
    "table-node",
    `table-node--${state}`,
    table.kind === "view" ? "table-node--view" : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      <div className="table-node__header" style={{ height: HEADER_HEIGHT }}>
        <span className="table-node__name">{table.name}</span>
        {table.kind === "view" ? (
          <span className="badge badge--view" title="ビュー">
            VIEW
          </span>
        ) : null}
        {table.schema ? (
          <span className="table-node__schema">{table.schema}</span>
        ) : null}
      </div>
      <div className="table-node__columns">
        {table.columns.map((col) => {
          const isActive = activeColumnName === col.name;
          const isRelated = relatedColumnNames.has(col.name);
          const rowClass = isActive
            ? "table-node__row table-node__row--active"
            : isRelated
            ? "table-node__row table-node__row--related"
            : "table-node__row";
          return (
            <div
              className={rowClass}
              style={{ height: ROW_HEIGHT }}
              key={col.name}
              onMouseEnter={() => handleColumnEnter(col.name)}
              onMouseLeave={handleColumnLeave}
              onClick={(e) => handleColumnClick(e, col.name)}
            >
              <Handle
                type="target"
                position={Position.Left}
                id={`t-${col.name}`}
                className="table-node__handle"
                isConnectable={false}
              />
              <span className="table-node__col-name">
                {col.is_primary_key ? (
                  <span className="badge badge--pk" title="主キー">
                    PK
                  </span>
                ) : null}
                {col.is_foreign_key ? (
                  <span className="badge badge--fk" title="外部キー">
                    FK
                  </span>
                ) : null}
                <span
                  className={
                    col.is_primary_key ? "col-name col-name--pk" : "col-name"
                  }
                >
                  {col.name}
                </span>
              </span>
              <span className="table-node__col-type">
                {col.data_type}
                {col.nullable ? "" : " *"}
              </span>
              <Handle
                type="source"
                position={Position.Right}
                id={`s-${col.name}`}
                className="table-node__handle"
                isConnectable={false}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const TableNode = memo(TableNodeComponent);

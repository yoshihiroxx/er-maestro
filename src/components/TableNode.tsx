import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  HEADER_HEIGHT,
  ROW_HEIGHT,
  type TableNodeData,
} from "../graph/buildGraph";

function TableNodeComponent({ data }: NodeProps) {
  const { table, state } = data as TableNodeData;

  return (
    <div className={`table-node table-node--${state}`}>
      <div className="table-node__header" style={{ height: HEADER_HEIGHT }}>
        <span className="table-node__name">{table.name}</span>
        {table.schema ? (
          <span className="table-node__schema">{table.schema}</span>
        ) : null}
      </div>
      <div className="table-node__columns">
        {table.columns.map((col) => (
          <div
            className="table-node__row"
            style={{ height: ROW_HEIGHT }}
            key={col.name}
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
        ))}
      </div>
    </div>
  );
}

export const TableNode = memo(TableNodeComponent);

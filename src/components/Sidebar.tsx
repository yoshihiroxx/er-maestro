import { useMemo, useState } from "react";
import { useSchemaStore } from "../store/schemaStore";

export function Sidebar() {
  const schema = useSchemaStore((s) => s.schema);
  const selectedTableId = useSchemaStore((s) => s.selectedTableId);
  const searchQuery = useSchemaStore((s) => s.searchQuery);
  const setSearchQuery = useSchemaStore((s) => s.setSearchQuery);
  const selectTable = useSchemaStore((s) => s.selectTable);

  const [showWarnings, setShowWarnings] = useState(false);

  const tables = useMemo(() => {
    const all = [...(schema?.tables ?? [])].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    const q = searchQuery.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (t) =>
        t.id.toLowerCase().includes(q) ||
        t.columns.some((c) => c.name.toLowerCase().includes(q)),
    );
  }, [schema, searchQuery]);

  if (!schema) {
    return (
      <aside className="sidebar">
        <div className="sidebar__empty">スキーマ未読み込み</div>
      </aside>
    );
  }

  const warnings = schema.warnings;

  return (
    <aside className="sidebar">
      <div className="sidebar__search">
        <input
          type="search"
          placeholder="テーブル / カラムを検索…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.currentTarget.value)}
        />
      </div>

      <div className="sidebar__count">
        {tables.length} / {schema.tables.length} テーブル
      </div>

      <ul className="sidebar__list">
        {tables.map((t) => {
          const fkCount = t.columns.filter((c) => c.is_foreign_key).length;
          return (
            <li key={t.id}>
              <button
                type="button"
                className={
                  t.id === selectedTableId
                    ? "table-item table-item--active"
                    : "table-item"
                }
                onClick={() => selectTable(t.id)}
                title={t.source_file}
              >
                <span className="table-item__name">{t.name}</span>
                {t.schema ? (
                  <span className="table-item__schema">{t.schema}</span>
                ) : null}
                <span className="table-item__meta">
                  {t.columns.length} 列{fkCount > 0 ? ` · FK${fkCount}` : ""}
                </span>
              </button>
            </li>
          );
        })}
        {tables.length === 0 ? (
          <li className="sidebar__empty">該当なし</li>
        ) : null}
      </ul>

      {warnings.length > 0 ? (
        <div className="sidebar__warnings">
          <button
            type="button"
            className="warnings__toggle"
            onClick={() => setShowWarnings((v) => !v)}
          >
            ⚠ 警告 {warnings.length} 件 {showWarnings ? "▲" : "▼"}
          </button>
          {showWarnings ? (
            <ul className="warnings__list">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}

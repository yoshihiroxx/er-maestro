import { useMemo, useState } from "react";
import { useSchemaStore, type SchemaFilter } from "../store/schemaStore";

const NO_SCHEMA_FILTER: SchemaFilter = "__none__";

export function Sidebar() {
  const schema = useSchemaStore((s) => s.schema);
  const selectedTableId = useSchemaStore((s) => s.selectedTableId);
  const searchQuery = useSchemaStore((s) => s.searchQuery);
  const schemaFilter = useSchemaStore((s) => s.schemaFilter);
  const setSearchQuery = useSchemaStore((s) => s.setSearchQuery);
  const setSchemaFilter = useSchemaStore((s) => s.setSchemaFilter);
  const selectTable = useSchemaStore((s) => s.selectTable);
  const jumpToTable = useSchemaStore((s) => s.jumpToTable);

  const [showWarnings, setShowWarnings] = useState(false);

  const schemaOptions = useMemo(() => {
    const names = new Set<string>();
    let hasNoSchema = false;
    for (const table of schema?.tables ?? []) {
      if (table.schema) names.add(table.schema);
      else hasNoSchema = true;
    }
    return {
      names: [...names].sort((a, b) => a.localeCompare(b)),
      hasNoSchema,
    };
  }, [schema]);

  const tables = useMemo(() => {
    const all = [...(schema?.tables ?? [])].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    const q = searchQuery.trim().toLowerCase();
    return all.filter((t) => {
      const matchesSchema =
        schemaFilter === "__all__" ||
        (schemaFilter === NO_SCHEMA_FILTER
          ? t.schema === null
          : t.schema === schemaFilter);
      if (!matchesSchema) return false;
      if (!q) return true;
      return (
        t.id.toLowerCase().includes(q) ||
        t.columns.some((c) => c.name.toLowerCase().includes(q))
      );
    });
  }, [schema, searchQuery, schemaFilter]);

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
          id="sidebar-search-input"
          type="search"
          placeholder="テーブル / カラムを検索…  ( / でフォーカス )"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && tables.length > 0) {
              e.preventDefault();
              jumpToTable(tables[0].id);
              e.currentTarget.blur();
            }
          }}
        />
        <select
          aria-label="スキーマで絞り込み"
          value={schemaFilter}
          onChange={(e) => setSchemaFilter(e.currentTarget.value as SchemaFilter)}
        >
          <option value="__all__">すべてのスキーマ</option>
          {schemaOptions.names.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
          {schemaOptions.hasNoSchema ? (
            <option value={NO_SCHEMA_FILTER}>未分類</option>
          ) : null}
        </select>
      </div>

      <div className="sidebar__count">
        {tables.length} / {schema.tables.length} テーブル
        {schemaFilter !== "__all__"
          ? ` · ${
              schemaFilter === NO_SCHEMA_FILTER ? "未分類" : schemaFilter
            }`
          : ""}
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

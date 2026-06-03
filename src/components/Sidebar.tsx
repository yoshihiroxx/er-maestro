import {
  useCallback,
  useMemo,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useSchemaStore, type SchemaFilter } from "../store/schemaStore";

const NO_SCHEMA_FILTER: SchemaFilter = "__none__";
const SIDEBAR_WIDTH_KEY = "er-maestro:sidebar-width";
const DEFAULT_SIDEBAR_WIDTH = 280;
const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 520;

function clampSidebarWidth(width: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width));
}

function initialSidebarWidth(): number {
  const saved = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
  if (!saved) return DEFAULT_SIDEBAR_WIDTH;
  const width = Number(saved);
  return Number.isFinite(width)
    ? clampSidebarWidth(width)
    : DEFAULT_SIDEBAR_WIDTH;
}

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
  const [sidebarWidth, setSidebarWidth] = useState(initialSidebarWidth);

  const handleResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = sidebarWidth;

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const nextWidth = clampSidebarWidth(
          startWidth + moveEvent.clientX - startX,
        );
        setSidebarWidth(nextWidth);
      };

      const handlePointerUp = (upEvent: PointerEvent) => {
        const nextWidth = clampSidebarWidth(
          startWidth + upEvent.clientX - startX,
        );
        setSidebarWidth(nextWidth);
        window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(nextWidth));
        document.body.classList.remove("is-resizing-sidebar");
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      };

      document.body.classList.add("is-resizing-sidebar");
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp, { once: true });
    },
    [sidebarWidth],
  );

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
      <aside className="sidebar" style={{ width: sidebarWidth }}>
        <div className="sidebar__empty">スキーマ未読み込み</div>
        <div
          className="sidebar__resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="左カラムの幅を変更"
          onPointerDown={handleResizeStart}
        />
      </aside>
    );
  }

  const warnings = schema.warnings;

  return (
    <aside className="sidebar" style={{ width: sidebarWidth }}>
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
      <div
        className="sidebar__resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="左カラムの幅を変更"
        onPointerDown={handleResizeStart}
      />
    </aside>
  );
}

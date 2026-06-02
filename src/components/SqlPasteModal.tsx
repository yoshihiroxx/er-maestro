import { useState } from "react";
import { useSchemaStore } from "../store/schemaStore";

const DIALECTS = [
  { value: "", label: "自動検出" },
  { value: "generic", label: "Generic" },
  { value: "ansi", label: "ANSI" },
  { value: "postgresql", label: "PostgreSQL" },
  { value: "mysql", label: "MySQL" },
  { value: "sqlite", label: "SQLite" },
];

export function SqlPasteModal() {
  const open = useSchemaStore((s) => s.sqlPasteOpen);
  const closeSqlPaste = useSchemaStore((s) => s.closeSqlPaste);
  const loadFromText = useSchemaStore((s) => s.loadFromText);

  const [sql, setSql] = useState("");
  const [dialect, setDialect] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleParse = async () => {
    if (!sql.trim()) {
      setError("SQL を入力してください。");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await loadFromText(sql, dialect || undefined);
      setSql("");
      setDialect("");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (loading) return;
    setSql("");
    setDialect("");
    setError(null);
    closeSqlPaste();
  };

  return (
    <div className="modal-backdrop" onClick={handleClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sql-paste-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <h2 id="sql-paste-title" className="modal__title">
            SQL を貼り付け
          </h2>
          <button
            type="button"
            className="modal__close"
            onClick={handleClose}
            disabled={loading}
            aria-label="閉じる"
          >
            x
          </button>
        </div>

        <div className="modal__body">
          <label className="modal__field-label" htmlFor="sql-input">
            SQL DDL
          </label>
          <textarea
            id="sql-input"
            className="modal__textarea"
            value={sql}
            onChange={(e) => setSql(e.currentTarget.value)}
            placeholder={
              "CREATE TABLE users (\n  id SERIAL PRIMARY KEY,\n  name TEXT NOT NULL\n);"
            }
            rows={14}
            disabled={loading}
            autoFocus
          />

          <label className="modal__field-label" htmlFor="dialect-select">
            ダイアレクト（任意）
          </label>
          <select
            id="dialect-select"
            className="modal__select"
            value={dialect}
            onChange={(e) => setDialect(e.currentTarget.value)}
            disabled={loading}
          >
            {DIALECTS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>

          {error ? <p className="modal__error">{error}</p> : null}
        </div>

        <div className="modal__footer">
          <button
            type="button"
            className="modal__btn modal__btn--secondary"
            onClick={handleClose}
            disabled={loading}
          >
            キャンセル
          </button>
          <button
            type="button"
            className="modal__btn modal__btn--primary"
            onClick={handleParse}
            disabled={loading || !sql.trim()}
          >
            {loading ? "解析中…" : "ER 図を生成"}
          </button>
        </div>
      </div>
    </div>
  );
}

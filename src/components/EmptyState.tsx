import { pickDirectory, pickSqlFiles } from "../api/commands";
import type { RecentEntry } from "../api/recentStore";
import { useSchemaStore } from "../store/schemaStore";

function secondaryText(entry: RecentEntry): string {
  if (entry.paths.length === 1) return entry.paths[0];
  return `${entry.paths.length} 個のファイル`;
}

export function EmptyState() {
  const status = useSchemaStore((s) => s.status);
  const error = useSchemaStore((s) => s.error);
  const recent = useSchemaStore((s) => s.recent);
  const loadFromPaths = useSchemaStore((s) => s.loadFromPaths);
  const openSqlPaste = useSchemaStore((s) => s.openSqlPaste);
  const removeRecent = useSchemaStore((s) => s.removeRecent);
  const clearRecent = useSchemaStore((s) => s.clearRecent);

  const openFiles = async () => {
    const paths = await pickSqlFiles();
    if (paths) await loadFromPaths(paths, "files");
  };
  const openFolder = async () => {
    const paths = await pickDirectory();
    if (paths) await loadFromPaths(paths, "directory");
  };

  if (status === "loading") {
    return (
      <div className="empty-state">
        <div className="empty-state__spinner" />
        <p>スキーマを解析中…</p>
      </div>
    );
  }

  return (
    <div className="empty-state">
      <h1 className="empty-state__title">er-maestro</h1>
      <p className="empty-state__lead">
        SQL スキーマファイル (DDL) を読み込んで ER 図を可視化します。
      </p>
      <div className="empty-state__actions">
        <button type="button" onClick={openFiles}>
          .sql ファイルを開く
        </button>
        <button type="button" onClick={openFolder}>
          フォルダを開く
        </button>
        <button type="button" onClick={openSqlPaste}>
          SQL を貼り付け
        </button>
      </div>
      {status === "error" && error ? (
        <p className="empty-state__error">読み込みに失敗しました: {error}</p>
      ) : null}
      {recent.length > 0 ? (
        <section className="empty-state__recent" aria-label="最近開いた項目">
          <div className="recent__header">
            <h2 className="recent__title">最近開いた項目</h2>
            <button
              type="button"
              className="recent__clear"
              onClick={() => clearRecent()}
            >
              履歴をクリア
            </button>
          </div>
          <ul className="recent__list">
            {recent.map((entry) => (
              <li key={entry.id} className="recent__row">
                <button
                  type="button"
                  className="recent__item"
                  title={entry.paths.join("\n")}
                  onClick={() => loadFromPaths(entry.paths, entry.kind)}
                >
                  <span className="recent__icon" aria-hidden="true">
                    {entry.kind === "directory" ? "DIR" : "SQL"}
                  </span>
                  <span className="recent__text">
                    <span className="recent__label">{entry.label}</span>
                    <span className="recent__path">{secondaryText(entry)}</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="recent__remove"
                  aria-label={`「${entry.label}」を履歴から削除`}
                  title="履歴から削除"
                  onClick={() => removeRecent(entry.id)}
                >
                  x
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

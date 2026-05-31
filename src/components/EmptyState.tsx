import { pickDirectory, pickSqlFiles } from "../api/commands";
import { useSchemaStore } from "../store/schemaStore";

export function EmptyState() {
  const status = useSchemaStore((s) => s.status);
  const error = useSchemaStore((s) => s.error);
  const loadFromPaths = useSchemaStore((s) => s.loadFromPaths);

  const openFiles = async () => {
    const paths = await pickSqlFiles();
    if (paths) await loadFromPaths(paths);
  };
  const openFolder = async () => {
    const paths = await pickDirectory();
    if (paths) await loadFromPaths(paths);
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
      </div>
      {status === "error" && error ? (
        <p className="empty-state__error">読み込みに失敗しました: {error}</p>
      ) : null}
    </div>
  );
}

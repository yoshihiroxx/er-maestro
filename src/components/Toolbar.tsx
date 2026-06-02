import { pickDirectory, pickSqlFiles } from "../api/commands";
import { useSchemaStore, type LayoutKind } from "../store/schemaStore";

const LAYOUTS: { value: LayoutKind; label: string }[] = [
  { value: "dagre-lr", label: "横 (dagre)" },
  { value: "dagre-tb", label: "縦 (dagre)" },
  { value: "elk", label: "ELK 直交" },
];

export function Toolbar() {
  const schema = useSchemaStore((s) => s.schema);
  const status = useSchemaStore((s) => s.status);
  const selectedTableId = useSchemaStore((s) => s.selectedTableId);
  const focusMode = useSchemaStore((s) => s.focusMode);
  const focusDepth = useSchemaStore((s) => s.focusDepth);
  const layoutKind = useSchemaStore((s) => s.layoutKind);
  const inferenceEnabled = useSchemaStore((s) => s.inferenceEnabled);
  const loadFromPaths = useSchemaStore((s) => s.loadFromPaths);
  const setFocusMode = useSchemaStore((s) => s.setFocusMode);
  const setFocusDepth = useSchemaStore((s) => s.setFocusDepth);
  const setLayoutKind = useSchemaStore((s) => s.setLayoutKind);
  const setInferenceEnabled = useSchemaStore((s) => s.setInferenceEnabled);
  const clearSelection = useSchemaStore((s) => s.clearSelection);
  const openSqlPaste = useSchemaStore((s) => s.openSqlPaste);

  const loading = status === "loading";

  const openFiles = async () => {
    const paths = await pickSqlFiles();
    if (paths) await loadFromPaths(paths);
  };
  const openFolder = async () => {
    const paths = await pickDirectory();
    if (paths) await loadFromPaths(paths);
  };

  return (
    <header className="toolbar">
      <div className="toolbar__brand">er-maestro</div>

      <div className="toolbar__group">
        <button type="button" onClick={openFiles} disabled={loading}>
          .sql ファイルを開く
        </button>
        <button type="button" onClick={openFolder} disabled={loading}>
          フォルダを開く
        </button>
        <button type="button" onClick={openSqlPaste} disabled={loading}>
          SQL を貼り付け
        </button>
      </div>

      {schema ? (
        <>
          <div className="toolbar__group">
            <label className="toolbar__label">レイアウト</label>
            <select
              value={layoutKind}
              onChange={(e) => setLayoutKind(e.currentTarget.value as LayoutKind)}
            >
              {LAYOUTS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>

          <div className="toolbar__group">
            <label className="toolbar__check">
              <input
                type="checkbox"
                checked={focusMode}
                onChange={(e) => setFocusMode(e.currentTarget.checked)}
              />
              関連のみ表示
            </label>
            <label className="toolbar__check">
              <input
                type="checkbox"
                checked={inferenceEnabled}
                onChange={(e) => setInferenceEnabled(e.currentTarget.checked)}
              />
              推論FK表示
            </label>
            <label className="toolbar__label">深さ</label>
            <select
              value={focusDepth}
              onChange={(e) => setFocusDepth(Number(e.currentTarget.value))}
            >
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
            </select>
            <button
              type="button"
              onClick={clearSelection}
              disabled={!selectedTableId}
            >
              全体表示
            </button>
          </div>

          <div className="toolbar__spacer" />
          <div className="toolbar__status">
            <span className="badge badge--dialect" title="検出されたSQLダイアレクト">
              {schema.dialect}
            </span>
            <span className="toolbar__counts">
              {schema.tables.length} テーブル · {schema.relationships.length} リレーション
            </span>
          </div>
        </>
      ) : (
        <div className="toolbar__spacer" />
      )}
    </header>
  );
}

# er-maestro

SQL スキーマファイル (DDL) から ER 図を生成・可視化する**読み取り専用**デスクトップアプリ。編集機能は持ちません。

- 複数の `.sql` ファイル / ディレクトリを読み込み、1 つのスキーマとして統合
- テーブル＝ノード、外部キー＝エッジとして ER 図を全体表示
- 特定のテーブルを選択すると、関連する（FK でつながる）テーブルだけに絞って表示
- 複数 SQL ダイアレクトを自動判別（PostgreSQL / MySQL / SQLite / MSSQL / 汎用）

## 技術スタック

- **Rust + Tauri v2** — SQL 解析（[`sqlparser`](https://crates.io/crates/sqlparser)）とファイル読み込み（`std::fs` + `walkdir`）をネイティブ側で実行
- **React + TypeScript + Vite** — UI
- **[@xyflow/react](https://reactflow.dev) (React Flow v12)** — グラフ描画
- **dagre / elkjs** — 自動レイアウト
- **Zustand** — 状態管理
- **[ts-rs](https://github.com/Aleph-Alpha/ts-rs)** — Rust の型から TypeScript 型を自動生成

## アーキテクチャ

```
ユーザがファイル/フォルダを選択 (tauri-plugin-dialog)
  → invoke('parse_schema', { paths })
      Rust: walkdir で .sql を再帰列挙 → std::fs で読込
           → sqlparser で best-effort パース（ダイアレクト判別、失敗文はスキップして warnings へ）
           → AST から Table / Column / Relationship を抽出、FK を正規化キーで解決
           → SchemaModel (JSON) を返却
  → React: Zustand に格納 → buildGraph → dagre/ELK でレイアウト → React Flow 描画
           → テーブル選択 → 隣接探索(BFS) → 関連のみ表示 / 全体表示
```

ファイル読み込みを Rust 側で行うことで `tauri-plugin-fs` のスコープ制約を回避しています。

## 開発

```bash
npm install
npm run tauri dev      # アプリ起動（Rust ビルド + Vite）
```

`examples/` に動作確認用のサンプルスキーマ（複数ファイルにまたがる FK 付き）があります。アプリ起動後「フォルダを開く」で `examples/` を選ぶと統合された ER 図が表示されます。

### 型生成（Rust → TypeScript）

スキーマモデルの型は Rust の `src-tauri/src/model.rs` が単一の出典（source of truth）です。`src/types/*.ts` は ts-rs により生成されます。`model.rs` を変更したら再生成してください:

```bash
npm run gen:types      # = cd src-tauri && cargo test export_bindings
```

### テスト / ビルド

```bash
cd src-tauri && cargo test   # パーサのユニット/統合テスト + 型生成
npm run build                # tsc + vite build（フロントの型チェック含む）
```

## 既知の制限・今後の拡張

- ELK レイアウトはメインスレッドで実行（数百テーブル規模では Web Worker 化を検討）
- FK は `CREATE TABLE`（インライン/テーブルレベル）と `ALTER TABLE ADD CONSTRAINT` から抽出。命名規則ベースの推論（`user_id` → `users` 等）は未対応
- 解決できない FK（参照先テーブルが見つからない）はエッジを描かず、警告として一覧表示

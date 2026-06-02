# 大規模スキーマのパフォーマンスベンチ

PBI014 「大規模スキーマのパフォーマンステスト/最適化」で導入したベンチ
ハーネスの使い方と、現在の計測値・既知の制約をまとめる。

## ベンチ対象

UI を起動せず、グラフ生成/レイアウトの「重い側」だけを Node で再現する:

- `buildGraph` 相当 — `SchemaModel` → React Flow ノード/エッジ
- `buildAdjacency` + `relatedTables` (BFS depth=1)
- `layoutDagre` (LR/TB) — `@dagrejs/dagre` 同期実行
- `layoutElk` — `elkjs/lib/elk.bundled.js` 非同期実行

ノード幅・行高・spacing オプションは `src/graph/buildGraph.ts` および
`src/graph/layout/*.ts` と 1:1 一致させている。フロント側のパラメータを
変えたらこのスクリプトも合わせて更新する。

## スクリプト

| script | 用途 |
| --- | --- |
| `scripts/gen-bench-schema.mjs` | 合成 `SchemaModel` JSON を生成 (deterministic, seed 指定可) |
| `scripts/bench-graph.mjs` | 既存 JSON を読み、各フェーズを `performance.now()` で計測 |

`package.json` に短縮スクリプトを定義:

```bash
# 合成スキーマ (1000 テーブル / 平均 12 列 / FK 80%)
npm run bench:gen -- --tables 1000 --avg-cols 12 --fk-ratio 0.8 \
  --seed 42 --out tmp/bench-1000.json

# 3 回計測
npm run bench:graph -- --in tmp/bench-1000.json --iters 3
```

`tmp/` は `.gitignore` 済み (生成物のみ)。

## 現在の計測値 (M1 Mac, Node 22)

`seed=42` で固定したスキーマに対し iters=3 で実測した参考値。

| 規模 | tables / rels | dagre-lr (mean) | dagre-tb (mean) | elk (mean) |
| --- | --- | --- | --- | --- |
| 中 | 200 / 142 | ~21 ms | ~18 ms | ~57 ms |
| 大 | 500 / 398 | ~61 ms | ~44 ms | ~110 ms |
| 超大 | 1000 / 785 | ~103 ms | ~94 ms | ~367 ms |

`buildGraph` / `buildAdjacency` / `BFS` は全規模で 1 ms 未満。
レイアウトが支配的で、特に ELK は規模に対して急峻に伸びる。

**目安**: 数百テーブル規模 (= 500 tables 程度) なら dagre は十分実用域
(50 ms 前後)。ELK は 100 ms 程度かかるため初回レイアウト中はスピナー
を見せる、または既定 dagre のままで「必要なら ELK に切替」運用が望ましい。

## 既知のボトルネックと対応

1. **`Canvas.tsx` の `displayNodes` / `displayEdges` の全 spread 再生成**
   - 修正: state/hidden が変わらないノード/エッジは元の参照をそのまま
     返すよう変更。React Flow は参照比較で差分を取るため、選択切替で
     再 render される TableNode は実際に状態が変わったものだけになる。
2. **ELK のメインスレッド長時間ブロック** — 別 PBI (`pbi/893ecd80-elk-web-worker`,
   EPIC003) で Web Worker 化を進行中。ここでは触らない。
3. **ノード可視化のクリッピング** — `<ReactFlow onlyRenderVisibleElements />`
   は既に有効。仮想化は React Flow に委譲。

## 再現コマンド一覧

```bash
npm run bench:gen  -- --tables 200  --avg-cols 8  --fk-ratio 0.7 --seed 42 --out tmp/bench-200.json
npm run bench:gen  -- --tables 500  --avg-cols 10 --fk-ratio 0.8 --seed 42 --out tmp/bench-500.json
npm run bench:gen  -- --tables 1000 --avg-cols 12 --fk-ratio 0.8 --seed 42 --out tmp/bench-1000.json

npm run bench:graph -- --in tmp/bench-200.json  --iters 3
npm run bench:graph -- --in tmp/bench-500.json  --iters 3
npm run bench:graph -- --in tmp/bench-1000.json --iters 3
```

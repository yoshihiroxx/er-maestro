# リリース CI セットアップ

`.github/workflows/release.yml` は `v*` 形式のタグ push (もしくは workflow_dispatch) で
macOS (Universal: aarch64 + x86_64) と Windows (x86_64) 向けの Tauri バンドルを生成し、
GitHub Release (draft) に成果物を添付する。

## トリガー

| トリガー            | 動作                                                  |
| ------------------ | ----------------------------------------------------- |
| `git tag v0.1.0 && git push origin v0.1.0` | タグ名で draft release を作成し artefact を添付 |
| Actions UI → release → Run workflow        | `release_tag` 入力で任意のタグ名でテスト実行可 |

## 成果物

- macOS:
  - `er-maestro_<version>_aarch64.dmg` / `.app.tar.gz`
  - `er-maestro_<version>_x64.dmg` / `.app.tar.gz`
- Windows:
  - `er-maestro_<version>_x64-setup.exe` (NSIS)
  - `er-maestro_<version>_x64_en-US.msi` (WiX)

## 署名 / 公証

署名は別 PBI / 別フェーズで対応する。当面は署名 env を渡さない unsigned 運用とする。
証明書の準備が整った後、条件付き step または separate job として再導入する。

現状のビルドは macOS では ad-hoc 署名、Windows では unsigned となり、
Gatekeeper / SmartScreen で警告が表示されるが起動は可能。

## 動作確認手順

1. Secrets を未設定のまま試したい場合:
   1. ローカルから `git tag v0.0.0-test && git push origin v0.0.0-test`
   2. Actions の `release` ワークフローが緑になり draft release が生成されることを確認
   3. アーティファクトをダウンロードして起動 (unsigned のため警告を承諾して開く)
2. Secrets 設定後:
   1. 上記と同様にタグ push して artefact をダウンロード
   2. macOS: `spctl --assess --verbose=4 er-maestro.app` で `accepted` を確認
   3. Windows: PowerShell で `Get-AuthenticodeSignature .\er-maestro_*-setup.exe` を確認

## 既知の制約

- macOS の Universal バイナリは matrix で 2 ターゲットを別ジョブとして生成している。
  単一の `.app` に統合する場合は `tauri-action` の `args` を `--target universal-apple-darwin`
  に変更し、Rust toolchain に `aarch64-apple-darwin` と `x86_64-apple-darwin` を両方追加すること。
- リリースは `releaseDraft: true` で生成されるので、最終公開はユーザー操作で行う。
- ci.yml の `clippy -D warnings` は新規 lint 違反でビルドを落とすため、main マージ前の
  ローカル `cargo clippy --all-targets -- -D warnings` 実行を推奨。

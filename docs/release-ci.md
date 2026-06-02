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

## 署名 / 公証 (任意)

下記 GitHub Secrets を repository / environment に設定すると tauri-action が自動で署名・
公証する。未設定の場合は ad-hoc 署名の unsigned ビルドが生成される (起動は可能だが
Gatekeeper/SmartScreen で警告)。

### macOS

| Secret 名                     | 用途                                                    |
| ---------------------------- | ------------------------------------------------------- |
| `APPLE_CERTIFICATE`           | Developer ID Application 証明書 (.p12) を base64 化したもの |
| `APPLE_CERTIFICATE_PASSWORD`  | .p12 のパスワード                                       |
| `APPLE_SIGNING_IDENTITY`      | 例: `Developer ID Application: Foo Bar (TEAMID)`         |
| `APPLE_ID`                    | 公証用 Apple ID                                         |
| `APPLE_PASSWORD`              | 公証用 App-specific Password                            |
| `APPLE_TEAM_ID`               | Apple Developer Team ID (10 桁)                          |

base64 化の例:

```sh
base64 -i developer_id_application.p12 | pbcopy
```

### Windows

| Secret 名                      | 用途                                                |
| ----------------------------- | --------------------------------------------------- |
| `WINDOWS_CERTIFICATE`          | EV/OV コード署名証明書 (.pfx) を base64 化したもの    |
| `WINDOWS_CERTIFICATE_PASSWORD` | .pfx のパスワード                                   |

> EV 証明書は HSM 必須のため、現状の GitHub Actions では OV (ファイル証明書) を推奨。
> SmartScreen の reputation 蓄積期間 (数ヶ月) を考慮した運用が必要。

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

# Phase 0 現状調査

**調査日:** 2026-10-19  
**対象コミット:** `50c9b8ef77ad3ab87952f62dead5a9d5025a1f62`  
**ブランチ:** `main`  
**作業ツリー:** 調査開始時はクリーン

## 基準状態

| 項目 | 確認結果 |
|---|---|
| Git remote | `origin` は `https://github.com/nishida0402shun-dev/SIGMA-Core` |
| remote main | 調査時点の `origin/main` は対象コミットと一致 |
| GitHub Actions | 対象コミットの Core CI run [39092158750](https://github.com/nishida0402shun-dev/SIGMA-Core/actions/runs/39092158750) は成功 |
| ローカル環境 | Node.js 24.18.0、npm 11.16.0、Windows。CIのNode.js 22は未実行 |
| 依存導入 | `npm ci` 成功、依存監査で脆弱性0件 |
| テスト | `npm test`: 45 passed、0 failed |
| 型検査 | `npm run typecheck`: 成功 |
| ライセンス | `npm run licenses:check`: 56 locked packages、全件メタデータあり |
| production依存監査 | `npm audit --omit=dev --audit-level=high`: 脆弱性0件 |
| Lint / build | `package.json` に実行スクリプトなし。未実行ではなく、このリポジトリに定義がない |

## 実装状況とギャップ

- 旧 `SIGMACore` / `knowledgeDB` の実装参照は見つからなかった。該当文字列は方針・監査文書に限られる。
- 原本バイト列はSHA-256のcontent-addressed blobとして保存・読み出し時に検証し、SQLite側の登録はトランザクション化されている。DB失敗時の孤立blobはあり得るが、reconciliationは読み取り専用。
- 抽出器は検証済みUTF-8 plain textのみ。PDFはシグネチャ検出に留まり、抽出は未対応。現在の共通位置モデルにはページ/offset/bounding boxがあるが、PDF由来の位置追跡は未検証。
- `SigmaStudioAdapter` はknowledge-source/page形式の互換境界であり、現行Studio document storeの置換・接続は確認されていない。Workspace選択も明示が必要。
- **確認した契約違反と対応:** `src/adapters/sigma-studio-adapter.ts` の `updatePageSemanticType` がrepositoryを直接更新していた。今回、更新を `CoreService.updatePageSemanticType` に移し、サービス層でactive状態・write権限を確認して成功操作を監査するよう変更した。adapterの戻り値契約は維持した。
- `docs/REQUIREMENTS_BASELINE.md` はA/B/Cの証拠区分を使用。旧AT-008/011/019/021/023の意味は未確定として保持されており、推測で再定義しない。

## 次の作業

1. adapter更新後の受け入れテスト20件は成功。read-only拒否と許可更新後の監査イベントを確認した。
2. 全テストと型検査を再実行する。
3. 作業計画 Phase 1 の原本永続化・重複・失敗時整合性について、既存テストが受け入れ条件を十分に証明するかを個別に照合する。

## 未確認

- 対象コミット以降にGitHub mainが進んだ場合の再調査
- Node.js 22でのローカル再現（GitHub Actionsの対象コミットCIは成功）
- Electron/OS配布、Studio実機統合、PDF/OCR、性能・巨大ファイル試験
- Studio側の現行実装。別リポジトリはこの調査の対象外
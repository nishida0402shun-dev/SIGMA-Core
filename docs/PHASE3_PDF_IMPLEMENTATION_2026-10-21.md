# Phase 3: PDF 抽出・ページ位置情報・範囲取得の実装記録

- 実施日: 2026-10-21
- 対象: SIGMA Core
- 関連: `docs/SIGMA_CORE_WORK_PLAN.md` Phase 3 / Phase 5、`docs/PDF_EXTRACTION_SPIKE_PLAN_2026-10-19.md`
- 状態: テキスト PDF のページ抽出・位置情報・範囲取得を実装し、ローカルテストで確認済み。CI・Electron 実機・OCR・日本語レイアウトは未確認。

## 1. 目的

計画書 Phase 3 の「PDF 抽出と部分取得」および Phase 5 の「位置情報を利用した部分取得 API」を、既存の fail-closed 方針を維持して実装する。PDF を「検出できるが抽出不能」から「ページ単位の出典付きで抽出できるが、スキャン・OCR は未対応」へ進める。

## 2. 実装内容

### 2.1 抽出契約のページ対応

- `src/extraction.ts` の `Extractor` を非同期対応にし、`ExtractionResult` に `pages`、`warnings`、`extractorId`、`extractorVersion`、`pageCount` を追加した。
- `ExtractedPage` は `pageNumber`、`textContent`、ページ内 `startOffset` / `endOffset`、`boundingBox`、ページ単位の警告を持つ。
- `plainTextExtractor` は従来どおり UTF-8 テキストを 1 ページとして抽出する。
- `pdfExtractor`（`builtin-pdf` 1.0.0）を追加した。
  - `unpdf` 1.9.1（MIT、同梱 PDF.js 6.4.299 / Apache-2.0）を使用。
  - ページごとにテキスト項目を取得し、`pageNumber` と対応付ける。
  - ページ内のテキスト項目 union を PDF user space（左下原点、1/72 inch）の `boundingBox` として保存する。
  - テキストのないページは location を作成し、`PDF_PAGE_TEXT_UNAVAILABLE` を記録する。
  - 全ページにテキストがない場合は `PDF_TEXT_UNAVAILABLE_OCR_REQUIRED` で失敗する。
  - 暗号化は `PDF_ENCRYPTED`、破損は `PDF_PARSE_FAILED`、タイムアウトは `PDF_TIMEOUT` で失敗する。
  - 入力サイズ 50 MiB、ページ数 2,000、ページ文字数 2,000,000、タイムアウト 30 秒を既定上限とする。呼び出し側でより低い上限を指定できる。

### 2.2 抽出来歴の永続化

- schema migration version 3 を追加し、`extracted_artifacts` に `warnings_json` と `page_count` を追加した。
- 失敗した PDF 抽出も `failed` artifact として記録する。これにより「形式は認識したがテキスト抽出できない（スキャン等）」と「抽出器がない未対応形式」を区別できる。
- `registerObject` と隔離データ復旧は、抽出器が実際に返した ID・バージョン・状態・警告を保存する。呼び出し元提供ページは引き続き `caller-provided-pages` / `external-1` として区別する。

### 2.3 部分取得 API

- `CoreService.getPageRange(auth, objectId, startPage, endPage, maxPagesPerRequest = 100)` を追加した。
  - 1-based inclusive。
  - 逆転範囲、範囲過大、抽出済み最大ページ超過、ページ欠落を明示エラーで拒否する。
  - 論理削除済み・Purged・権限なしは既存の fail-closed 経路で拒否する。
- `CoreService.getExtractionArtifacts()` を追加し、抽出状態と警告を取得できるようにした。
- MCP に `core_get_page_range` と `core_get_extraction_info` を追加した。
- Studio adapter に `getPageRange()` と `getExtractionInfo()` を追加した。

## 3. 変更ファイル

- `src/extraction.ts`
- `src/models/types.ts`
- `src/db/migrations.ts`
- `src/persistence/core-repository.ts`
- `src/persistence/sqlite-repository.ts`
- `src/services/core-service.ts`
- `src/ingestion-service.ts`
- `src/mcp/core-mcp-adapter.ts`
- `src/mcp/stdio-server.ts`
- `src/adapters/sigma-studio-adapter.ts`
- `package.json` / `package-lock.json`（`unpdf` 追加）
- `tests/core.test.ts`
- `tests/persistence.test.ts`
- `tests/pdf-extraction.test.ts`（新規）
- `tests/pdf-fixture.ts`（新規）
- `tests/fixtures/encrypted.pdf`（新規）
- `tests/fixtures/japanese-two-pages.pdf`（新規）
- `tests/fixtures/README.md`（新規）
- `tests/sqlite-migrations.test.ts`
- `docs/DATA_CONTRACT.md`
- `docs/FILE_SUPPORT.md`
- `docs/DEPENDENCY_DECISIONS.md`
- `docs/LIBRARY_EVALUATION.md`
- `docs/PDF_EXTRACTION_SPIKE_PLAN_2026-10-19.md`
- `docs/DEPENDENCY_LICENSE_INVENTORY.md`
- `README.md`

## 4. 実行したテスト

```bash
npm test
npm run typecheck
node scripts/check-license-inventory.mjs --check
```

## 5. テスト結果

- `npm test`: 61 tests / 11 suites、61 pass、0 fail（2026-10-21、ローカル Node.js 24.21.0）。
- `npm run typecheck`: 成功。
- `node scripts/check-license-inventory.mjs --check`: 成功（57 locked packages、license metadata 欠落なし）。
- PDF テストで確認した項目:
  - 2 ページ PDF のページ番号と本文の対応
  - 日本語 2 ページ PDF（埋め込みフォント）の本文とページ境界
  - ページ内オフセットと bounding box の生成
  - 空ページを含む PDF の `partial` 状態とページ単位警告
  - 全ページ空 PDF の OCR 必須判定、failed artifact、検索非ヒット
  - 暗号化 PDF の fail-close
  - 破損 PDF の fail-close
  - 入力サイズ・ページ数上限
  - 範囲取得、逆転・範囲外・過大・欠落・権限なし・削除済みの拒否
  - Studio adapter / MCP 経由の範囲取得と抽出来歴取得

## 6. CI 結果

- 未確認。この記録の時点では GitHub Actions を実行していない。CI 成功を主張しない。

## 7. 未確認事項

- 複数列レイアウトの読み順（日本語の基本 2 ページ fixture は確認済み）
- ページ内の単語・領域単位の座標精度（現状はページ単位 union）
- 長大 PDF のメモリ使用量・処理時間の実測
- Electron / Windows / macOS の配布環境での動作
- OCR（スキャン PDF）は未実装
- 既存 Studio ストアとの実接続は未実施

## 8. 回帰リスクと確認内容

- `extractSource` を非同期化したため、同期呼び出しはコンパイルエラーになる。リポジトリ内の呼び出し元（`ingestion-service`、`core-service`）は更新済みで、旧 `SqliteCoreRepository` のテストも非同期化した。
- schema version 3 は既存 v2 DB に対する `ALTER TABLE` のみで、既存行には既定値 `[]` が入る。v1/v2 からの新規作成と v3 の列存在をテストした。
- 失敗 PDF でも artifact 行が増えるため、artifact 件数を「抽出成功回数」とみなす既存呼び出しがあれば確認が必要。`listExtractedArtifacts` は状態を返すため、呼び出し側は `status` を確認する必要がある。
- 依存追加により lockfile と配布サイズが増える。`unpdf` は約 2.2 MB（同梱 PDF.js を含む）。Electron パッケージングでの同梱・ライセンス表記は未確認。

## 9. 次の作業

1. 複数列 PDF fixture の追加と読み順期待値の検証
2. 長大 PDF のメモリ・処理時間測定
3. CI（Node 22/24）の実行結果確認
4. Studio 読み取り PoC での `getPageRange` / `getExtractionInfo` 接続
5. OCR を別機能として扱うかの設計判断

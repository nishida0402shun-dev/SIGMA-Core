# OCR 実装状況の確認と Phase 1/2 追実装

- 実施日: 2026-10-25
- 対象: SIGMA Core
- 基準コミット: `e477c03`（`origin/main`、確認開始時点）
- 関連: `docs/OCR_IMPLEMENTATION_PLAN_2026-10-23.md`、`docs/ENGINEERING_GAP_REVIEW_2026-10-23.md`、`docs/DATA_CONTRACT.md`
- 状態: テキスト PDF のページ抽出、OCR エンジン契約、Tesseract CLI アダプタ、ページ単位の OCR ルーティング、PNG/JPEG 単体 OCR、schema v5 のページ単位来歴（抽出方法・エンジン・言語・信頼度）をローカルテストと CI（Node.js 22/24）で確認。実 Tesseract での認識は Linux コンテナでスモーク確認。対象 Windows 11 実機、代表データでの CER/WER、メモリ測定は未実施。

## 1. 確認した現状

確認開始時点のローカル `main` は `5934a9d` で、`origin/main` より 7 コミット遅れていた。`git fetch` / `git pull --ff-only` で `e477c03` に更新した。未追跡だった本計画書とギャップレビューは保持している。

`origin/main` には次の OCR 関連実装が既に存在した。

| コミット | 内容 |
|---|---|
| `6ee7fc7` | `OcrEngine` / `OcrPageResult` 契約とテスト |
| `6e15b2f` | `TesseractCliEngine`（プロセス分離、一時ファイル、タイムアウト） |
| `e477c03` | テキストのない PDF を OCR エンジンへルーティング |

CI: `e477c03` の push に対する Core CI（Node.js 22 / 24）は成功（run [40147450131](https://github.com/nishida0402shun-dev/SIGMA-Core/actions/runs/40147450131)）。確認開始時点のローカルテストは 69 件成功。

## 2. 確認で判明した不足

| ID | 事実 | 影響 | 対応 |
|---|---|---|---|
| OCR-F1 | ルーティングが PDF 全体の bytes を `processPage(imageBytes)` に渡していた | Tesseract は PDF を画像として読めないため、実エンジンでは全ページ失敗する。テストは bytes を無視する mock のため検出できなかった | ページ単位の `PdfPageRenderer` を追加し、PDF ページを PNG に変換してから渡すよう修正 |
| OCR-F2 | 全ページが空の場合だけ OCR し、混在 PDF の空ページは OCR しなかった | スキャンページを含む混在 PDF で本文が欠落する | 埋め込みテキストのないページだけを対象に変更。テキストページは再 OCR しない |
| OCR-F3 | `CoreService` は `ocrEngine` を受け取れるが、stdio エントリポイントが注入していなかった | 実運用の MCP 経路では OCR が一度も動かない | `TesseractCliEngine` を stdio エントリポイントで注入 |
| OCR-F4 | `execFileSync` を async メソッド内で使用していた | OCR 中に Core のイベントループが停止する | `execFile` + timeout + kill に変更し、一時ディレクトリを一括削除 |
| OCR-F5 | ラスタライズ手段がなく、canvas 依存も未導入だった | スキャン PDF の OCR 経路が成立しない | `unpdf.renderPageAsImage` + 任意依存 `@napi-rs/canvas` を追加。ページあたり 16 MP に制限 |
| OCR-F6 | `FILE_SUPPORT.md` / `DATA_CONTRACT.md` が「OCR 未実装」のままだった | 実装と公開契約が不一致 | 実装状況・警告コード・制限・未検証事項を更新 |

## 3. 今回の変更

- `src/ocr.ts`: `PdfPageRenderer` 契約を追加。`OcrPageResult` に実際に使用した言語を追加。
- `src/pdf-page-renderer.ts`（新規）: unpdf + `@napi-rs/canvas` によるページ単位 PNG 変換。1 ページずつ処理し、16 MP を上限にスケールを調整。
- `src/extraction.ts`:
  - `ExtractOptions.pdfPageRenderer` を追加（既定は unpdf レンダラー）。
  - 埋め込みテキストのないページだけを OCR。混在 PDF ではテキストページを保持。
  - OCR 成功時は `partial` とし、`PDF_PAGE_OCR_APPLIED` にエンジン ID / バージョンを記録。
  - 描画失敗 `OCR_RENDER_FAILED`、エンジン失敗 `OCR_PAGE_FAILED`、空結果 `OCR_PAGE_TEXT_UNAVAILABLE` をページ単位で記録。
  - OCR 後も本文がない場合は `PDF_TEXT_UNAVAILABLE_OCR_REQUIRED` で fail closed。
  - PNG/JPEG シグネチャを `image` として検出し、`imageOcrExtractor` で単体画像をページ 1 として OCR。
  - 画像 OCR は埋め込みテキストのフォールバックがないため、エンジン未導入・失敗・空結果・タイムアウトを fail closed にする。
  - `ExtractOptions.ocrLanguage` を追加し、PDF / 画像の OCR 呼び出しへ言語指定を渡す。
  - OCR ページにエンジンが返した言語と平均単語信頼度を記録する。
- `src/tesseract-cli-engine.ts`:
  - 非同期 `execFile`、タイムアウト、引数検証（言語指定）、20 MiB の画像上限。
  - `--version` から実バージョンを取得して来歴に使用。一時ディレクトリを確実に削除。
  - `txt` と `tsv` を同時出力し、単語の `conf` 列から平均信頼度（0..1）を算出。TSV がない場合は信頼度なしとして OCR 自体は成功扱い。
  - 実際に使用した言語を結果に含める。
- `src/mcp/stdio-entry.ts`: Tesseract エンジンを注入。
- `src/index.ts`: レンダラーを公開。
- `src/models/types.ts`: `ExtractionMethod` と `SourceLocation` のページ単位来歴（`extractionMethod` / `warnings` / `ocrEngineId` / `ocrEngineVersion` / `ocrLanguage` / `ocrConfidence`）を追加。
- `src/db/migrations.ts`: schema v4 で `extraction_method`、`warnings_json`、`ocr_engine_id`、`ocr_engine_version`、schema v5 で `ocr_language`、`ocr_confidence` を追加（既存行は unknown / 空警告 / 言語・信頼度なし）。
- `src/persistence/core-repository.ts`: ページ来歴の保存・読み出し。
- `src/services/core-service.ts`: 抽出ページと caller-provided ページの来歴を location に反映。
- `src/adapters/sigma-studio-adapter.ts`: `KnowledgePage` でページ来歴を公開。
- `tests/ocr.test.ts`: 混在 PDF、全ページ OCR、描画失敗、エンジン未導入、実 canvas レンダリング、CLI 引数、タイムアウト、言語検証、ページ来歴の保存・取得、PNG 単体 OCR、画像 OCR の失敗経路、TSV 信頼度と言語の記録を追加。
- `tests/sqlite-migrations.test.ts`: v2 DB から v5 への移行で既存 location が保持されることを確認。
- `package.json` / `package-lock.json`: `@napi-rs/canvas` 1.0.13 を任意依存に追加（MIT）。
- 文書: `README.md`、`docs/DATA_CONTRACT.md`、`docs/FILE_SUPPORT.md`、`docs/DEPENDENCY_DECISIONS.md`、`docs/DEPENDENCY_LICENSE_INVENTORY.md`。

## 4. テスト結果

実行コマンド:

```bash
npm test
npm run typecheck
node scripts/check-license-inventory.mjs --check
```

- `npm test`: 81 tests / 16 suites、81 pass、0 fail（Node.js 24.21.0、ローカル）。
- `npm run typecheck`: 成功。
- ライセンス棚卸し: 69 locked packages、metadata 欠落なし。
- OCR テストで確認した内容:
  - 全ページ空の PDF で、ページごとに描画・OCR される
  - 混在 PDF で、テキストページは描画も OCR もされない
  - 描画失敗時にエンジンを呼ばず fail closed する
  - エンジン未導入時に描画せず `PDF_TEXT_UNAVAILABLE_OCR_REQUIRED` を返す
  - 実 PDF ページが PNG 署名付き bytes に変換される（`@napi-rs/canvas`）
  - CoreService 経由で OCR ページが `partial` artifact として保存され、本文が検索できる
  - OCR ページの location に `extractionMethod = "ocr"`、エンジン ID / バージョン、言語、信頼度、ページ警告が保存され、`getPage` / `getPageRange` で取得できる
  - 混在 PDF でテキストページは `embedded-text`、OCR ページは `ocr` として区別される
  - v2 DB を v5 に移行しても既存 location の本文が保持され、来歴は unknown / 空警告 / 言語・信頼度なしになる
  - PNG 単体が `image` として検出され、OCR 結果がページ 1・`partial`・エンジン来歴付きで返る
  - 画像 OCR でエンジン未導入、空結果、実行失敗、タイムアウトが fail closed になる
  - Tesseract CLI の引数渡しと出力読み取り（POSIX スタブ）
  - Tesseract TSV から平均単語信頼度を算出し、使用言語を返す
  - タイムアウト時に `OCR_TIMEOUT` を返す
  - 不正な言語指定を拒否する

追加の手動スモークテスト（CI 対象外、Linux コンテナ）:

- Tesseract 5.3.4 + `jpn` / `eng` を導入し、`tests/fixtures/japanese-two-pages.pdf` を 2 倍スケールで描画して OCR した。
- 埋め込みテキストを正解とした CER はページ 1 が 3.33%、ページ 2 が 5.26%。差分は主にコロン前後の空白。
- 描画と OCR の合計時間はページ 1 が約 1.08 秒、ページ 2 が約 0.63 秒。
- 合成した英語画像（canvas 描画）を Tesseract 5.3.4 / `eng` で処理し、本文は正解と一致、平均単語信頼度は 0.9646、処理時間は約 2.43 秒だった。信頼度はエンジン由来であり、CER/WER の代用ではない。
- これは合成した埋め込みフォント PDF と合成画像の結果であり、実スキャン、低画質、表、複数列、対象 Windows 11 の精度・速度を示さない。

## 5. 未確認・制約

- 実 Tesseract はローカルの Linux コンテナでスモークテストしたのみ。CI は Tesseract をインストールせず、対象 Windows 11 / Ryzen 5 4500U / RAM 8GB での動作、ピーク RAM、処理時間は未測定。
- CER / WER は合成 fixture 2 ページの参考値のみ。実スキャン、表・数式・手書き・縦書き・複数列の精度は未評価。
- OCR 結果のページ単位エンジン情報・言語・平均単語信頼度は schema v5 で保存する。信頼度は正解率ではなく、前処理設定・モデル情報は未保存。
- 言語指定は `ExtractOptions.ocrLanguage` と Tesseract エンジンの `defaultLanguage` で行える。stdio エントリポイントは `SIGMA_OCR_LANGUAGE` を既定言語として読む（未設定時は `jpn+eng`）。CoreService/MCP のリクエスト単位で文書ごとに言語を切り替える経路は未実装。
- 画像 OCR は PNG/JPEG のシグネチャ検出のみ。GIF/WebP/TIFF/SVG、複数フレーム、EXIF 回転、言語モデルの導入状況・カバレッジ、実写真の精度は未検証。単体画像は埋め込みテキストのフォールバックがないため、エンジンがない場合は失敗する。
- `@napi-rs/canvas` の Windows/macOS/Electron 同梱と ABI は未確認。
- キャンセル、進捗通知、ジョブキュー、同時実行数制御、重複排除は未実装。

## 6. ギャップレビューとの対応

| ID | 今回の状態 |
|---|---|
| CORE-006 抽出来歴 | 抽出器 ID / バージョン / 状態 / 警告を保存。PDF OCR は `builtin-pdf+<engine>`、画像 OCR は `builtin-image-ocr+<engine>`。schema v5 でページ単位の抽出方法・警告・OCR エンジン ID / バージョン・言語・平均単語信頼度も保存。前処理設定・モデル情報は未保存 |
| CORE-007 形式対応表示 | PDF と PNG/JPEG は部分対応。OCR は注入時のみ動作し、精度は未検証と明記 |
| CORE-008 PDF 品質 | テキスト PDF、日本語、空ページ、暗号化、破損、上限、混在 PDF の OCR 経路をテスト。複数列・領域座標・OCR 精度は未検証。画像は PNG 単体の OCR 経路と失敗経路のみテスト |
| CORE-012 DB マイグレーション | schema v4 / v5 は `source_locations` への `ALTER TABLE` のみ。v2→v5 の既存 location 保持と列存在をテスト |
| CORE-022 CI | `e477c03` の CI 成功を確認。`6cc486c` も Node.js 22 / 24 で成功（run [40158483104](https://github.com/nishida0402shun-dev/SIGMA-Core/actions/runs/40158483104)）。schema v4 の `bc45a1c` も成功（run [40160137169](https://github.com/nishida0402shun-dev/SIGMA-Core/actions/runs/40160137169)）。画像 OCR の `ac212a8` も成功（run [40163290494](https://github.com/nishida0402shun-dev/SIGMA-Core/actions/runs/40163290494)）。言語・信頼度の `8bcb4ca` も成功（run [40301438003](https://github.com/nishida0402shun-dev/SIGMA-Core/actions/runs/40301438003)） |

上記以外の CORE-001〜CORE-024 は今回再監査していない。未確認の項目を解消済みとして扱わない。

## 7. 次の作業

1. 実 Tesseract（`jpn` / `eng`）を導入した環境で代表ページを処理し、CER/WER と処理時間を記録する。
2. Windows 11 対象 PC で Tesseract と `@napi-rs/canvas` の同梱・起動・メモリを確認する。
3. キャンセル・進捗・ジョブキューを、低メモリ環境の実測結果に基づいて設計する。
4. 前処理あり/なしを同一データで比較し、回転・傾き・ノイズ補正の効果を測る。

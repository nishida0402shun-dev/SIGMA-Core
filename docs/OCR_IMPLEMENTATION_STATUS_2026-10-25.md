# OCR 実装状況の確認と Phase 1/2 追実装

- 実施日: 2026-10-25
- 対象: SIGMA Core
- 基準コミット: `e477c03`（`origin/main`、確認開始時点）
- 関連: `docs/OCR_IMPLEMENTATION_PLAN_2026-10-23.md`、`docs/ENGINEERING_GAP_REVIEW_2026-10-23.md`、`docs/DATA_CONTRACT.md`
- 状態: テキスト PDF のページ抽出、OCR エンジン契約、Tesseract CLI アダプタ、ページ単位の OCR ルーティング、PNG/JPEG 単体 OCR、schema v5 のページ単位来歴（抽出方法・エンジン・言語・信頼度）、前処理設定の来歴、キャンセル・進捗・ジョブキュー・重複排除、6 カテゴリの合成ベンチマーク、長文メモリプローブ、対象ハードウェア診断、Electron/ネイティブモジュール診断を実装し、ローカルテストと CI で確認。対象 Windows 11 / Ryzen 5 4500U / 8GB 実機、代表データでの CER/WER、PaddleOCR 比較、Electron パッケージ起動は未実施。

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
- OCR 結果のページ単位エンジン情報・言語・平均単語信頼度は schema v5、前処理来歴は schema v6 で保存する。2026-10-27 以降、標準前処理は有効オプションを `canvas-deskew-contrast@1.1.1+upscale+contrast` の形式で記録する。信頼度は正解率ではない。モデル識別子はエンジン/前処理の ID とバージョン以上の粒度では保存しない。
- 言語指定は `ExtractOptions.ocrLanguage` と Tesseract エンジンの `defaultLanguage` で行える。stdio エントリポイントは `SIGMA_OCR_LANGUAGE` を既定言語として読む（未設定時は `jpn+eng`）。CoreService/MCP のリクエスト単位で文書ごとに言語を切り替える経路は未実装。
- 画像 OCR は PNG/JPEG のシグネチャ検出のみ。GIF/WebP/TIFF/SVG、複数フレーム、EXIF 回転、言語モデルの導入状況・カバレッジ、実写真の精度は未検証。単体画像は埋め込みテキストのフォールバックがないため、エンジンがない場合は失敗する。
- `@napi-rs/canvas` の Windows/macOS/Electron 同梱と ABI は未確認。
- キャンセル、進捗通知、ジョブキュー、同時実行数制御、重複排除は 2026-10-27 に実装済み（§9）。ただしキューと重複排除はプロセス内のみで、複数プロセス/端末間の排他ではない。

## 6. ギャップレビューとの対応

| ID | 今回の状態 |
|---|---|
| CORE-006 抽出来歴 | 抽出器 ID / バージョン / 状態 / 警告を保存。PDF OCR は `builtin-pdf+<engine>`、画像 OCR は `builtin-image-ocr+<engine>`。schema v5 でページ単位の抽出方法・警告・OCR エンジン ID / バージョン・言語・平均単語信頼度も保存。前処理設定・モデル情報は未保存 |
| CORE-007 形式対応表示 | PDF と PNG/JPEG は部分対応。OCR は注入時のみ動作し、精度は未検証と明記 |
| CORE-008 PDF 品質 | テキスト PDF、日本語、空ページ、暗号化、破損、上限、混在 PDF の OCR 経路をテスト。複数列・領域座標・OCR 精度は未検証。画像は PNG 単体の OCR 経路と失敗経路のみテスト |
| CORE-012 DB マイグレーション | schema v4 / v5 は `source_locations` への `ALTER TABLE` のみ。v2→v5 の既存 location 保持と列存在をテスト |
| CORE-022 CI | `e477c03` の CI 成功を確認。`6cc486c` も Node.js 22 / 24 で成功（run [40158483104](https://github.com/nishida0402shun-dev/SIGMA-Core/actions/runs/40158483104)）。schema v4 の `bc45a1c` も成功（run [40160137169](https://github.com/nishida0402shun-dev/SIGMA-Core/actions/runs/40160137169)）。画像 OCR の `ac212a8` も成功（run [40163290494](https://github.com/nishida0402shun-dev/SIGMA-Core/actions/runs/40163290494)）。言語・信頼度の `8bcb4ca` も成功（run [40301438003](https://github.com/nishida0402shun-dev/SIGMA-Core/actions/runs/40301438003)）。前処理・ベンチマーク・Windows CI の `7c0eda0` も Node.js 22 / 24 と Windows OCR で成功（run [40512320864](https://github.com/nishida0402shun-dev/SIGMA-Core/actions/runs/40512320864)）。キャンセル・キュー・拡張ベンチマークの `5db84df` も Node.js 22 / 24 と Windows OCR で成功（run [40529182736](https://github.com/nishida0402shun-dev/SIGMA-Core/actions/runs/40529182736)） |

上記以外の CORE-001〜CORE-024 は今回再監査していない。未確認の項目を解消済みとして扱わない。

## 7. 次の作業

1. 実 Tesseract（`jpn` / `eng`）を導入した環境で代表ページを処理し、CER/WER と処理時間を記録する。合成ベンチマークは §9 で実施済みだが、代表スキャンは未実施。
2. Windows 11 対象 PC で `npm run report:hardware` と `npx electron scripts/electron-native-probe.mjs --write` を実行し、OS/CPU/RAM、Tesseract 言語、キャンバス、PDF 描画、SQLite FTS5、OCR スモーク、パッケージ内パスを確認する。
3. 承認された環境で PaddleOCR / PaddleOCR-VL を同一データに対して実行し、CER/WER・速度・ピーク RAM・ライセンスを記録する（§9 の blocker を参照）。
4. 実データで前処理あり/なしを比較し、表・複数列・数式・写真・手書きの制約を更新する。

## 8. 2026-10-27 追実装：前処理・ベンチマーク・Windows CI

§7 の 1・2・4 に対する評価基盤を追加した。§7 の 3（キャンセル・進捗・ジョブキュー）は未着手。前処理・ベンチマーク・Windows CI は `ab136b2` と PATH 修正 `7c0eda0` でコミットし、`7c0eda0` の CI が成功している。

### 追加内容

- `src/image-preprocessor.ts`（新規）: opt-in の前処理。狭い画像の拡大、外れ値 0.01% を除いたコントラスト伸長、投影プロファイルによる最大 ±5° の傾き補正を行う。1 ページずつ処理し、均一画像ではコントラスト補正をスキップする。
- `ExtractOptions.imagePreprocessor`: PDF の OCR 対象ページと単体画像の OCR 前に適用。前処理中の例外・タイムアウトはそのページを fail closed にし、エンジンを呼ばない。
- `CoreService.registerObject` / `SigmaStudioAdapter.addFiles`: オブジェクト単位の `ocrLanguage` と `imagePreprocessor` を受け取れるようにした。stdio MCP は読み取り専用ツールのみのため、引き続きエンジン既定言語を使う。
- schema v6: `source_locations.ocr_preprocessing` に `<id>@<version>` を保存。既存行は NULL。`KnowledgePage` でも公開する。
- `scripts/ocr-benchmark.ts`（新規）: PDF ページまたは canvas 画像を対象に、CER / WER / エンジン信頼度 / 処理時間 / ピーク RSS を測る。`--preprocess` で同一ケースを前処理ありで再実行する。
- `benchmarks/ocr/cases.json`（新規）: 日本語 fixture 2 ページと英語 canvas テキストに対し、clean / low-res / rotate-2 / blur-1 / noise / low-contrast の 18 ケースを定義。
- `.github/workflows/ci.yml`: `windows-latest` で Tesseract を導入し、単体テストと `scripts/ocr-windows-smoke.ts` を実行するジョブを追加。
- Tesseract TSV の信頼度計算で、本文が空の単語行を除外するよう修正。

### ローカル結果

- `npm test`: 88 tests / 16 suites、88 pass、0 fail（Node.js 24.21.0、Linux x64）。
- `npm run typecheck`: 成功。
- `npm run licenses:check`: 69 locked packages、欠落なし。
- CI: `7c0eda0` の Core CI（Node.js 22 / 24）と Windows OCR（`windows-latest`、Tesseract 5.5.3）が成功（run [40512320864](https://github.com/nishida0402shun-dev/SIGMA-Core/actions/runs/40512320864)）。Windows ジョブでは単体テストと実 Tesseract スモークが通った。初回の `ab136b2` では Chocolatey が現在のシェルに PATH を反映せず `Verify Tesseract` が失敗したため、`GITHUB_PATH` へ追加する修正を入れた。
- ベンチマーク（Tesseract 5.3.4、`jpn+eng` / `eng`、合成ケース 18 件、各 1 回）:
  - 前処理なし: 平均 CER 10.09%、英語平均 WER 0.00%、合計 12.6 秒、ピーク RSS 183.4 MiB。
  - 前処理あり: 平均 CER 0.56%、英語平均 WER 0.00%、合計 16.7 秒、ピーク RSS 234.1 MiB。
  - 差は主に劣化させた日本語ケース（low-res、rotate-2）で生じた。clean な日本語ページは前処理なしが 0.00%、前処理ありが 3.33% で、前処理が常に有効とは言えない。
  - 信頼度と CER の相関（n=18）は前処理なしで Pearson -0.873 / Spearman -0.661、前処理ありで Pearson -0.644 / Spearman -0.589。信頼度は精度の代用にしない。
  - 1% パーセンタイルでのコントラスト伸長は、疎な本文ページで紙面のノイズ床を「黒」と誤認してノイズを全階調に増幅し、OCR が空になることを確認したため、外れ値のみを除く 0.01% に変更した。前処理の個別オプションを有効化した比較はこの修正後の値である。
- 上記は合成 fixture とシステムフォント描画による 1 回の測定であり、実スキャン、写真、表、数式、手書き、縦書き、複数列、対象 PC の性能を示さない。

### 未確認・残件（§8 時点。§9 で一部解消）

- Windows CI ジョブは `windows-latest` で成功したが、対象 Windows 11 / Ryzen 5 4500U / RAM 8GB 実機ではない。
- 前処理の個別オプションは §9 で `+settings` として来歴に保存するよう解消した。カスタム前処理が `settings` を省略した場合は `<id>@<version>` のみになる。
- キャンセル、進捗通知、ジョブキュー、同時実行数制御、重複排除は §9 で実装した。プロセス内のみで、複数プロセス間の排他ではない。
- PaddleOCR / PaddleOCR-VL の比較は §9.7 の blocker により未実施。Electron 同梱は §9.6 の診断スクリプトまでで、パッケージ起動は未検証。長時間処理のメモリは §9.4 で 30 ページまで測定した。

## 9. 2026-10-27 追実装：キャンセル・キュー・カテゴリ評価・実機診断

§7 の 3（キャンセル・進捗・キュー）を実装し、§7 の 1・2・4 の評価基盤を拡張した。合成データと Linux コンテナでの結果であり、実スキャン・対象実機・PaddleOCR・パッケージ済み Electron の検証ではない。

### 9.1 実装

- `src/ocr.ts`: `OcrCancelledError`、`isOcrCancelled`、`throwIfAborted`、`ImagePreprocessor.settings` を追加。`OcrOptions.signal` を追加。
- `src/extraction.ts`: `status = "cancelled"`、`ExtractionProgress`（page-started / page-rendered / page-preprocessed / ocr-completed / page-completed / page-failed / cancelled）、`ExtractOptions.signal` / `onProgress` を追加。PDF・画像の両経路で、ページ境界と前処理・OCR 呼び出しにキャンセルを伝播する。進捗コールバックの例外は抽出結果に影響させない。
- `src/tesseract-cli-engine.ts`: `execFile` に `AbortSignal` を渡し、キャンセル時に子プロセスを終了する。キャンセルとタイムアウトを別エラーコードに分離。
- `src/image-preprocessor.ts`: 標準前処理の設定を `settings` として公開し、`canvas-deskew-contrast@1.1.1+upscale+contrast` の形式で来歴に記録する。1000px 未満でも拡大率が 1.2 倍未満なら再サンプリングをスキップする（薄い罫線・文字輪郭の不要なぼけを避けるため）。
- `src/ocr-job-queue.ts`（新規）: 既定同時実行数 1、最大キュー長 100、同一キーの in-flight 重複排除、キュー内キャンセル、容量超過 `OCR_QUEUE_FULL`、`stats()`、`onIdle()`。
- `src/services/core-service.ts`: 抽出をキュー経由にし、キーを `<contentHash>|<language>|<preprocessor-id@version+settings>` とする。コンテンツハッシュ単位のロックで同一内容の同時登録を直列化し、1 回の抽出・1 オブジェクトに収束させる。キャンセル時は artifact を保存せず `OCR_CANCELLED` を監査する。`getOcrQueueStats()` を追加。
- `src/adapters/sigma-studio-adapter.ts`: ファイル単位の `signal` と `onProgress` を転送。
- `src/index.ts`: `ocr-job-queue.ts` と `image-preprocessor.ts` を公開。
- `tests/ocr-job-queue.test.ts`（新規）: 同時実行数、重複排除、キュー内キャンセル、容量超過、失敗統計、idle を検証。
- `tests/ocr.test.ts`: 実 Tesseract のキャンセル、PDF キャンセル、事前キャンセル画像、進捗順序、設定来歴、CoreService の重複登録・キャンセル・進捗を追加。
- `scripts/ocr-benchmark.ts`: 6 カテゴリ（printed-document / table / multi-column / formula / photo / handwriting-proxy）、`--case`、`--preprocess=upscale|contrast|deskew`、カテゴリ別集計を追加。
- `benchmarks/ocr/cases.json`: 表（タブ区切りセル＋罫線）、2 段組、数式、写真風グラデーション、手書き風ジッタの合成ケースを追加（計 24 ケース）。
- `scripts/ocr-memory-probe.ts`（新規）: 画像のみの PDF を生成し、ページ単位で描画・OCR しながら RSS を 100ms 間隔でサンプリングする。
- `scripts/hardware-report.ts`（新規）: OS/CPU/RAM/ディスク、Node、Tesseract バージョンと言語、SQLite/FTS5、canvas、PDF 描画、OCR スモークを JSON/Markdown で出力する。必須チェック失敗時は非ゼロ終了。
- `scripts/electron-native-probe.mjs`（新規）: 素の Node と Electron の両方で、canvas、SQLite/FTS5、Tesseract、PDF 描画を確認する。
- `package.json`: `benchmark:ocr:memory`、`report:hardware`、`probe:electron-native` を追加。

### 9.2 テスト・検証結果

- `npm test`: 103 tests / 19 suites、103 pass、0 fail（Node.js 24.21.0、Linux x64）。
- `npm run typecheck`: 成功。
- `npm run licenses:check`: 69 locked packages、license metadata 欠落なし。新規依存なし。
- CI: `5db84df` の Core CI（Node.js 22 / 24）と Windows OCR（`windows-latest`、Tesseract）が成功（run [40529182736](https://github.com/nishida0402shun-dev/SIGMA-Core/actions/runs/40529182736)）。Windows ジョブでは単体テストと実 Tesseract スモークが通った。
- `scripts/ocr-windows-smoke.ts` は今回のローカル実行では再実行していない。同等の実 Tesseract・canvas・PDF 描画スモークは `hardware-report.ts` で成功している。

### 9.3 合成ベンチマーク（Tesseract 5.3.4、24 ケース、各 1 回）

| 構成 | 平均 CER | 英語平均 WER | 合計時間 | ピーク RSS |
|---|---:|---:|---:|---:|
| 前処理なし | 10.02% | 7.41% | 15.3 s | 184.5 MiB |
| upscale のみ | 10.54% | 7.41% | 19.3 s | 204.4 MiB |
| contrast のみ | 7.83% | 7.41% | 18.7 s | 213.0 MiB |
| deskew のみ | 12.80% | 7.41% | 17.3 s | 214.8 MiB |
| 3 オプション全部 | 6.23% | 7.41% | 19.9 s | 214.4 MiB |

カテゴリ別の主な結果（前処理なし）:

| カテゴリ | ケース数 | 平均 CER | 備考 |
|---|---:|---:|---|
| printed-document | 18 | 10.09% | clean はほぼ 0%。low-res とノイズで悪化 |
| table | 2 | 0.00% | 合成罫線表は良好。upscale 時は低解像度側が 80.49% に悪化 |
| multi-column | 1 | 30.14% | 読み順が崩れる。列検出は未実装 |
| formula | 1 | 21.74% | 上付き・記号が欠落 |
| photo | 1 | 0.00% | 単純な白文字グラデーションのみ |
| handwriting-proxy | 1 | 7.14% | 合成ジッタ文字。実手書きではない |

- `contrast` は printed-document の平均 CER を 10.09% → 7.16% に下げた。
- `upscale` は clean table を守るガード後でも、低解像度の罫線表を 0% → 80.49% に悪化させた。表スキャンでは既定で無効にすべき根拠になる。
- `deskew` は単独では平均 CER を 10.09% → 12.80% に悪化させた。合成ケースの多くが既に水平で、投影プロファイルの補正が過剰に働く可能性がある。
- 3 オプション全部は printed-document を 0.56% まで改善するが、表の低解像度ケースの悪化は残る。カテゴリ別に採否を決める必要がある。
- 信頼度と CER の相関は構成により Pearson -0.82 〜 -0.53、Spearman -0.51 〜 -0.38。信頼度を精度の代用にしない。

### 9.4 長文メモリプローブ（Linux コンテナ、150 dpi、`--expose-gc`）

| ページ数 | OCR ページ | 時間 | ページ平均 | ベースライン RSS | ピーク RSS | GC 後 RSS |
|---:|---:|---:|---:|---:|---:|---:|
| 12 | 12 | 20.4 s | 1704 ms | 107.1 MiB | 155.7 MiB | 147.1 MiB |
| 30 | 30 | 49.2 s | 1639 ms | 109.1 MiB | 156.6 MiB | 120.9 MiB |

ピーク RSS は 12 ページと 30 ページでほぼ同じで、ページ数に比例した増加は見られない。ページ単位処理と一時ファイル削除が機能している範囲の証拠である。ただし 1 回の測定であり、ネイティブ canvas と子プロセスのメモリが RSS に完全には現れない可能性がある。対象 Windows 11 / 8GB 実機での再測定が必要。

### 9.5 ハードウェア診断（ローカル Linux コンテナ）

`npm run report:hardware` の結果:

- OS: Linux 6.8.0-1064-azure、x64。
- CPU: AMD EPYC 7763 64-Core Processor、論理 2 CPU。
- RAM: 7942.3 MiB（空き 3773.9 MiB）。
- Node.js 24.21.0、V8 13.6、ABI 137。
- Tesseract 5.3.4、言語 `eng,jpn,osd`。
- SQLite: `node:sqlite` 3.53.4、FTS5 有効。
- canvas、PDF 描画（PNG 31,826 bytes）、OCR スモーク（"SIGMA hardware check 12345"、CER 0.00%、333 ms、信頼度 0.9620）が成功。

これは対象 PC の結果ではない。RAM 容量が偶然近いだけで、CPU・OS・ストレージ・Tesseract のビルドが異なる。

### 9.6 Electron / ネイティブモジュール

`npm run probe:electron-native`（素の Node 24.21.0、ABI 137）で canvas、`node:sqlite` + FTS5、Tesseract 5.3.4、PDF 描画が成功した。これはパッケージ済み Electron の検証ではない。対象機では次を確認する:

1. `better-sqlite3` を使う場合、Electron の ABI に合わせて `@electron/rebuild` で再ビルドする。`node:sqlite` が使える Electron なら必須ではない。
2. `@napi-rs/canvas` のネイティブバイナリを `asarUnpack` し、`app.asar.unpacked` からロードできることを確認する。
3. Tesseract 実行ファイルと `tessdata` を `extraResources` に含め、`TESSERACT_PATH` を設定する。書き込み可能な一時ディレクトリを確認する。
4. パッケージ済みバイナリで `npx electron scripts/electron-native-probe.mjs --write` を実行する。
5. Windows 11 実機で `npm run report:hardware` を実行し、結果を `benchmarks/ocr/results/` に保存する。

### 9.7 PaddleOCR 比較（未実施・blocker）

比較は未実施。試行と遮断の記録:

- ローカルの Python 3.14.2 には PaddlePaddle の wheel がなく、`pip index versions paddlepaddle` は「No matching distribution」を返した。
- `/usr/bin/python3.12` は存在するが `ensurepip` がなく、`python3.12 -m venv` で pip を導入できない。
- `python3.12-venv` の apt インストール、`get-pip.py` の取得・実行、PaddleOCR/PaddlePaddle の pip インストールは実行環境のポリシーで遮断された。システム変更・外部インストーラ実行・第三者のパッケージ導入には明示的な承認が必要。

承認された環境での手順:

```bash
# Python 3.12 + venv を用意した環境で
python3.12 -m venv /tmp/paddle-venv
/tmp/paddle-venv/bin/pip install --upgrade pip
/tmp/paddle-venv/bin/pip install "paddlepaddle==<approved-cpu-version>" "paddleocr==<approved-version>"
```

同一の画像・正解テキスト・言語設定で Tesseract と PaddleOCR を実行し、`scripts/lib/ocr-metrics.ts` と同じ CER/WER 定義で比較する。モデル重み、前処理、推論ランタイム、推移的依存のライセンスを採用前に個別確認する。PaddleOCR / PaddlePaddle は Apache-2.0 とされるが、固定するバージョンとモデルの条件は導入時に再確認する。

### 9.8 残る未確認事項

- 代表スキャン・実写真・実手書き・実表・実数式・縦書き・複数列での CER/WER。合成ベンチマークは回帰信号であり、精度保証ではない。
- 対象 Windows 11 / Ryzen 5 4500U / 8GB 実機での速度・ピーク RAM・長時間安定性。
- PaddleOCR / PaddleOCR-VL との同一データ比較と採用判断。
- Electron パッケージ起動、ネイティブ ABI、`asarUnpack`、`extraResources`、コード署名。
- 複数プロセス/端末間の重複排除。現状はプロセス内のみ。
- 品質判定に基づく自動再処理（前処理変更・別エンジンへのフォールバック）。現状は呼び出し側が明示的に再実行する。

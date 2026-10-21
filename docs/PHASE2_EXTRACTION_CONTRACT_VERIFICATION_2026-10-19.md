# Phase 2: 抽出器契約の検証記録

> **更新（2026-10-21）:** 抽出契約はページ対応の非同期契約へ拡張され、PDF 抽出器が登録された。本文の「PDF 抽出器なし」に関する記述は当時の状態を示す。最新は `docs/PHASE3_PDF_IMPLEMENTATION_2026-10-21.md` を参照。

- 調査日: 2026-10-19
- 対象: SIGMA Core
- 状態: 現時点の実装とテストで、抽出器の共通契約と未対応形式の安全性は確認済み

## 1. 目的

Phase 2 の要件である「形式判定」「抽出器共通インターフェース」「未対応形式と抽出失敗の区別」「出典位置情報の保持」を、既存実装とテストでどこまで証明しているかを確認する。

## 2. 実装の確認結果

### 2.1 形式判定の共通契約

`src/extraction.ts` には、以下の共通契約が定義されている。

- `Format`: `plain-text | pdf | zip | unknown`
- `CapabilityStatus`: `supported | partially-supported | unsupported | unverified`
- `DetectionResult`: `format`, `status`, `evidence`
- `SourceRecord`: `sourceId`, `sha256`, `byteLength`, `detected`
- `TextExtraction`: `status`, `text?`, `warnings`, `source`

実装上、判定は「内容優先・拡張子は補助証拠」という設計になっている。これは計画書の「拡張子を無条件に信用しない」方針と一致する。

### 2.2 抽出器の共通インターフェース

`src/extraction.ts` の `Extractor` には次の形がある。

- `readonly format: Format`
- `extract(bytes, source): TextExtraction`

`ExtractorRegistry` は対象形式ごとに 1 つの抽出器しか登録できず、重複登録を `already registered` として拒否する。

### 2.3 抽出の失敗閉鎖と未対応形式の扱い

実装では、

- PDF のシグネチャ検出は可能
- ただし登録済み抽出器がない場合、`status: "failed"` と `warnings` を返す
- 形式が `unknown` の場合も、抽出は失敗として明示する

この設計により、「形式に対応していない」ことと「抽出自体が失敗した」ことを区別し、全体停止を避けている。

## 3. テスト済みの証跡

`tests/core.test.ts` で確認済みの主要ケースは以下の通り。

- 形式判定: UTF-8 text を `plain-text` として認識
- PDF シグネチャの検出: `wrong.bin` でも `%PDF-` で `pdf` を検出
- ZIP コンテナ検出: `zip` を認識しつつ、内容の対応有無は `unverified` とする
- 拡張子の誤認回避: `file.txt` に `0xff 0x00 0xfe` を含むと `unknown`
- 抽出: UTF-8 文字列をそのままテキストとして返す
- 抽出エラー: `No extractor registered for detected format: ...` を warning で返す
- 重複登録: 既存の抽出器再登録時に例外

## 4. Phase 2 受け入れ条件との照合

| 受け入れ条件 | 現状の証拠 |
| --- | --- |
| 抽出器を共通インターフェース経由で呼べる | `ExtractorRegistry` と `extractSource()` で確認済み |
| 未対応形式や破損ファイルを明確なエラーとして返す | `fails closed for a format without an extractor` で確認済み |
| 個別抽出エラーで Core 全体が停止しない | 設計上は個別抽出を `failed` として返し、全体停止しない |
| 位置情報がない場合はそのことを明示できる | 現行の共通モデルは `SourceLocation` を持つが、PDF 位置情報の検証は未完了 |

## 5. 未確認事項

次の Phase 2 で完全に照合すべき項目は以下の通り。

1. PDF 由来の位置情報とページ番号の対応が実装・テストで証明されているか
2. `SourceLocation` の共有契約が本当にすべての形式で扱えるか
3. 破損・空ファイル・巨大入力に対する境界値の確認
4. OCR 非対応やスキャン PDF の扱いに対する明確な分離

## 6. 結論

現時点では、Phase 2 の「形式判定」「抽出器共通契約」「未対応形式の安全な失敗」「UTF-8 plain text の抽出」については、実装とテストの両方で十分に裏付けられている。

一方で、計画書の前提にある「位置情報モデルの完全な整合性」と「PDF 由来のページ単位追跡」は、まだ実装と証跡が限定的である。したがって次に進むべき作業は、以下の順である。

1. Phase 2 の未確認項目をテストで明示する
2. 位置情報モデルの境界条件を確認する
3. PDF 以外の対応形式へ進む前に、共通契約の最小証跡を固定する

この確認により、Phase 3 (PDF 抽出と部分取得) への進行判断がより正確になる。

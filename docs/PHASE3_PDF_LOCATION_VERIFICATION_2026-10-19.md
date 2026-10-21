# Phase 3: PDF 抽出と位置情報の検証記録

> **更新（2026-10-21）:** 本文は実装前の調査記録である。テキスト PDF のページ抽出・位置情報・範囲取得は実装済み。最新の状態は `docs/PHASE3_PDF_IMPLEMENTATION_2026-10-21.md` を参照。

- 調査日: 2026-10-19
- 対象: SIGMA Core
- 状態: PDF のシグネチャ判定は確認済み。実際の PDF 抽出とページ位置情報の追跡は未実装・未検証

## 1. 目的

Phase 3 の要件である「PDF 抽出」「ページ単位の位置情報」「範囲取得」を、現行実装とテスト証跡から確認し、進行可能な範囲を明確にする。

## 2. 現在の実装状態

### 2.1 PDF は識別できるが、抽出は未対応

`src/extraction.ts` では `detectFormat()` が PDF シグネチャを検出する。

- `%PDF-` を頭部で検出した場合、`format: "pdf"` とし、`status: "unverified"` を返す
- 実際には PDF 抽出器が登録されていないため、`extractSource()` は `failed` を返す

これは計画書の「未対応形式と抽出失敗を区別する」方針に合っている。

### 2.2 位置情報モデルはあるが、PDF 由来の実証はない

`src/models/types.ts` には `SourceLocation` と `BoundingBox` が定義されている。

- `pageNumber`
- `startOffset` / `endOffset`
- `textContent`
- `semanticType`
- `title`
- `boundingBox`

ただし、現行の抽出器は UTF-8 plain text しか持たず、PDF での page-to-text 対応は証明されていない。

## 3. 確認済みのテスト証跡

`tests/core.test.ts` では次の挙動が検証されている。

- PDF シグネチャ検出: `%PDF-1.7` を `pdf` として認識
- 抽出失敗の安全な閉鎖: PDF には登録済み抽出器がないので `failed` を返す
- 位置情報の保存は text/plain では確認済み

`tests/acceptance-criteria.test.ts` では、以下も確認済みである。

- `pageNumber` が 0 など無効な値で例外を返す
- 既存のソース更新や検索は fail-close で維持される

## 4. Phase 3 の受け入れ条件との照合

| 受け入れ条件 | 現状 |
| --- | --- |
| PDF 抽出器を登録して抽出できる | 未実装 |
| ページ番号と抽出テキストを対応づける | 未検証 |
| 範囲取得 API を実装する | 未実装 |
| OCR 未対応を明示する | 判定は存在するが、実抽出型は未実装 |
| 位置情報の精度をテストで説明できる | 未実装 |

## 5. 結論

現時点では、PDF は「識別可能だが抽出不能」として安全に失敗する設計である。これは計画書の fail-closed 方針には適合するが、Phase 3 の実際の PDF 抽出・部分取得・位置情報追跡までは未完了である。

次の実務としては、以下の順で進めるのが適切である。

1. PDF 抽出器の候補ライブラリを評価する
2. 代表的な PDF サンプルで抽出方式を検証する
3. pageNumber と location を厳密に紐づけるテストを追加する
4. 必要なら最小の抽出器インターフェースを実装する

これにより、計画書の Phase 3 を実装の証跡付きで完了条件に近づける。

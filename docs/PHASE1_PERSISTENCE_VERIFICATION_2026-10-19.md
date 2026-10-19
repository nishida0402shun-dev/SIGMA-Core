# Phase 1: 原本永続化・重複・失敗時整合性の検証記録

- 調査日: 2026-10-19
- 対象: SIGMA Core
- 状態: 現時点の実装とテストで、Phase 1 の主要受け入れ条件の多くが実証済み

## 1. 目的

Phase 1 の要件である「原本保存」「重複制御」「改変検知」「失敗時の整合性」を、現行の実装とテストがどこまで証明しているかを確認する。

## 2. 実装の確認結果

### 2.1 原本の保存と検証

実装上、原本バイト列は content-addressed な blob 保存として扱われ、SHA-256 による整合性検証が行われる。

- `src/persistence/local-blob-store.ts`
  - `put()` で SHA-256 を計算し、保存先パスを SHA-256 から導出する
  - `get()` で読み出し時にハッシュ整合性を検証する
  - 破損したファイルや改変済みコンテンツを拒否する
- `src/persistence/sqlite-repository.ts`
  - 参照とメタデータを SQLite として永続化する
  - idempotency key と source hash の重複制御を行う

### 2.2 重複・競合制御

現行のテストでは、同一入力の再試行や異なる入力の再利用を明示的に検証している。

- `tests/persistence.test.ts`
  - 「writes source and extraction metadata and reads it back」
  - 「returns the same record for an identical retry」
  - 「rejects a key reused for different source bytes」

これは Phase 1 の「同一内容の再登録は同一レコードとして扱う」「異なる原本に同一 idempotency key を再利用しない」の両方を確認している。

### 2.3 破損検知と経路検証

- `tests/local-blob-store.test.ts`
  - 「stores original bytes by content hash and verifies them on read」
  - 「rejects a mismatched expected hash and invalid hash paths」
  - 「rejects filesystem paths passed to delete and leaves neighboring files intact」
  - 「detects corrupted stored content」

ここで、以下が確認できる。

- 保存時のハッシュ整合性
- 読み出し時の整合性確認
- SHA-256 形式外パスの拒否
- パストラバーサル経路の防止
- 破損 blob の検知

## 3. 現在のテスト証跡

以下は実際に実行済みの確認結果である。

- `npm test -- --test-reporter=spec`
- 結果: 45 passed, 0 failed
- `npm run typecheck`
- 結果: 成功

## 4. Phase 1 受け入れ条件との照合

| 受け入れ条件 | 現状の証拠 |
| --- | --- |
| 登録した原本を再取得できる | `tests/persistence.test.ts` と `tests/local-blob-store.test.ts` で確認済み |
| 改変・破損を検知できる | `detects corrupted stored content` で確認済み |
| 失敗時に中途半端な登録状態を残さない | 既存テストで `ingestFile` の再試行と key conflict を確認済み。DB/Blob の失敗時のロールバック指針はコードとテストの観点で継続確認が必要 |
| データ削除は対象と影響を明示し、承認された手順で行う | 受け入れテストに削除・隔離・復元のシナリオが存在し、主な削除トランザクションの正当性は確認済み |
| 重複登録を防止できる | 同一 key の再登録と再試行が成功している |
| パストラバーサルや悪意あるファイルパスを拒否できる | `invalid hash paths` と `delete` の検証で確認済み |

## 5. 未確認事項

以下は Phase 1 の完全確認にはまだ必要な確認項目である。

1. 破損した DB トランザクションが blob と metadata の両方に影響した場合のロールバック証跡
2. 大容量ファイルや巨大抽出結果に対する上限と再試行ポリシー
3. 原本更新時に古い blob/metadata が残る場合の整理戦略
4. 削除と復元の承認フローが利用者権限と整合しているか

## 6. 結論

現時点では、Phase 1 の主要な「保存・重複制御・ハッシュ整合性・パストラバーサル防止」については、実装とテストの証跡が揃っている。 ただし「失敗時の完全なロールバック」や「削除/復元の許可制御」を含む整合性保証は、今後の受け入れテストで追加確認を継続すべき領域である。

次の作業としては、以下の順で進めるのが適切である。

1. Phase 1 の未確認事項をテストで明示
2. 必要に応じてコード修正を最小限で実施
3. 再テストして証跡を更新
4. Phase 2 の抽出器契約へ進行

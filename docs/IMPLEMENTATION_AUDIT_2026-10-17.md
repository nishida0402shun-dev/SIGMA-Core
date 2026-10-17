# SIGMA Core 実装監査（2026-10-17）

**対象:** `nishida0402shun-dev/SIGMA-Core` の `main` と関連PR  
**方法:** GitHub上のソース・テスト・文書・CI結果の静的確認  
**未実施:** この監査ではローカルでのテスト実行、動的セキュリティ試験、Electron実機試験はしていない。以下は実コード上の観察とリスクであり、未実行の試験結果を成功とは扱わない。

## 判定サマリー

| 優先度 | 項目 | 判定 | 主な根拠 |
|---|---|---|---|
| P1 | 端末同期APIの認可・所有者確認 | 修正前に優先検証 | `src/services/core-service.ts` の `syncDevice(deviceId, userId)` は認証コンテキストを受け取らず、既存端末の保存済み `userId` と引数 `userId` の一致も検証しない。成功時に最終同期時刻を更新できるため、呼び出し境界次第では他端末の失効判定を延ばせる。実際の外部公開経路と呼び出し元を確認し、認可設計を固めてから修正する。 |
| P1 | 登録されたページ内容の抽出来歴 | 対応形式を過大表示するリスク | `registerObject` は呼び出し元が渡した `pages` を保存し、`extractorId: "builtin-extractor"`、`extractorVersion: "1.0.0"`、`status: "complete"` を記録する。一方、`src/index.ts` の実装済み既定抽出器はplain-textのみで、PDFは検出状態が `unverified`、PDF抽出器は登録されていない。ページが外部で抽出済みなのか、どの手段で得られたかを識別できないまま「complete」と記録しないよう、データ契約とAPI境界の整合が必要。 |
| P1 | Studio統合 | 未統合・置換禁止 | `docs/STUDIO-INTEGRATION-GAP-AUDIT.md` は現行Studioの `SharedWorkspaceDocStore` / `LocalSigmaDocStore` とCore adapterの契約が異なると記録。現時点でCoreを正本ストアへ直接切替しない。 |
| P2 | Blob reconciliation | PR上で提案、main未反映 | PR #17 は読み取り専用のblob整合性レポートとテストを追加するが、PRは未マージ。mainの `package.json` の `test` スクリプトには `tests/blob-reconciliation.test.ts` が含まれていない。PR #17 の採否とCIは別途管理する。 |
| P2 | バックアップ対象の説明と実装 | 文書/実装の差異を解消 | `src/services/backup-service.ts` のコメントは「Active and PendingDeletion」と説明するが、実際の一覧取得は `[\"Active\"]` のみ。削除待ちを除外する意図が正しいか、仕様決定とコメントを一致させる必要がある。 |
| P2 | mainの最新CI証拠 | 最新main SHAに紐づくrun未確認 | 現時点でmain先頭SHA `2461863a8571a7497ef81ad2dd4852a77913a6a4` に対するPRトリガーrunは取得できなかった。PR #17のheadに対するCI run 38967148373 と 38967207403 はNode 22/24とも成功。これはPR headの検証であり、現在のmainに対する新しいrunの代替とはしない。 |

## 詳細所見

### A. 端末同期の境界

確認したコード:
- `src/services/core-service.ts`: `syncDevice(deviceId, userId, nowUtc)`
- `src/services/device-quarantine-service.ts`: `evaluateDeviceStatus`
- `src/persistence/core-repository.ts`: `updateDeviceSyncTime`

`syncDevice` は端末が未登録の場合に新規作成し、登録済みの場合は既存レコードを取得して失効評価後に同期時刻を更新する。しかし、このメソッド自体には `AuthContext` や所有者確認がない。既存レコードの `userId` と要求側の `userId` が違っていても、拒否する処理は見当たらない。

**次の対応:** リポジトリ全体の呼び出し元を確認し、このメソッドがどの信頼境界から呼ばれるかを特定する。未信頼入力から到達可能なら、認証済み主体と端末所有者を照合するAPIに改め、所有者不一致・失効済み端末・再登録の負系テストを追加する。端末の再登録/失効解除ルールは新しい設計判断を要するため、現状のまま推測で追加しない。

### B. 抽出ステータスと出典情報

確認したコード:
- `src/index.ts`: `detectFormat`、`plainTextExtractor`、`defaultRegistry`、`extractSource`
- `src/services/core-service.ts`: `registerObject`
- `src/persistence/core-repository.ts`: `saveArtifactWithLocations`
- `docs/DATA_CONTRACT.md`

既定レジストリに登録される抽出器はplain-textのみ。PDF/ZIPは署名検出されても `unverified` として扱われ、抽出器がない場合は抽出失敗になる。一方、別経路の `registerObject` は任意の `pages` を受け取って保存し、そのデータを `builtin-extractor` による完全抽出として記録する。

**次の対応:** `registerObject` のページ入力を「信頼済み抽出結果」として受け入れるのか、Core自身の抽出を必須とするのかを明確にする。少なくとも、実際に実行していない抽出器名・バージョン・完全ステータスを自動記録しない。既存のStudio adapterからページ文字列を渡すケースも確認し、互換性を壊さない移行方針を決める。

### C. Blob reconciliationとCI

確認した事実:
- PR #17: [feat(core): add read-only blob reconciliation report](https://github.com/nishida0402shun-dev/SIGMA-Core/pull/17) はopen / 未マージ。
- CI run [38967148373](https://github.com/nishida0402shun-dev/SIGMA-Core/actions/runs/38967148373) と [38967207403](https://github.com/nishida0402shun-dev/SIGMA-Core/actions/runs/38967207403) は、Node 22と24のジョブが成功し、依存監査、ライセンス確認、テスト、型検査の各ステップも成功。
- 現在のmain先頭コミット `2461863a8571a7497ef81ad2dd4852a77913a6a4` に対して、取得したPRトリガーrun一覧は空だった。

**注意:** PRのCI成功は、PRがmainにマージされたことも、Electron実行環境で動作することも意味しない。

## 推奨実施順

1. **呼び出し境界の確認:** `syncDevice` と `quarantineData` の全呼び出し元・公開経路を調査する。
2. **抽出来歴の修正設計:** Core自身が抽出したデータと、外部から提供されたページデータを区別するデータ契約を決める。
3. **Blob reconciliation PR #17:** 差分・CI・副作用のないことをレビューし、別途採否を決定する。
4. **バックアップ対象仕様:** PendingDeletionを含めるべきかを決定し、実装・コメント・テストを一致させる。
5. 上記の変更後、Node 22/24でCIを再実行し、失敗した場合はログを確認する。
6. その後にPDF抽出、実MCPプロセス、復元試験、Electron配布試験へ進む。

## 現時点の結論

CoreにはSQLite永続化、FTS検索、認可サービス、バックアップ/復元、MCP adapterなどの実装がある。ただし、ファイル抽出の来歴、端末同期の信頼境界、Studioのストア契約、mainでのCI証拠は追加検証が必要。**この監査は静的コード確認であり、上記のリスクが動的試験で再現したとはまだ判定していない。**

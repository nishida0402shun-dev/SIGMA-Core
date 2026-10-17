# SIGMA Core 実装監査（2026-10-17）

**対象:** `nishida0402shun-dev/SIGMA-Core` の `main` と関連PR  
**方法:** GitHub上のソース・テスト・文書・CI結果の静的確認  
**未実施:** この監査ではローカルでのテスト実行、動的セキュリティ試験、Electron実機試験はしていない。以下は実コード上の観察とリスクであり、未実行の試験結果を成功とは扱わない。

## 判定サマリー

| 優先度 | 項目 | 判定 | 主な根拠 |
|---|---|---|---|
| P1 | 端末同期APIの認可・所有者確認 | 所有者不一致チェックを実装。認証境界は未確定 | `syncDevice(auth, deviceId, userId)` に空ID拒否、認証コンテキスト必須、`auth.subjectId === userId` の照合、既存端末の保存済み所有者との照合、および拒否監査記録を追加した。受入テストも追加した。なお、`AuthContext` を作成する外部bootstrap/呼び出し元が本当に信頼された認証主体に基づくかは、公開経路の調査が必要。 |
| P1 | 隔離データ登録の認可・整合性 | 登録入口に認証/端末所有者/Workspace検証を追加。復旧完全性は未検証 | `quarantineData(auth, ...)` は認証主体、登録済み端末の所有者、payloadのobjectId/Workspace scope、write権限を検証し、未登録端末の暗黙作成を廃止した。復旧処理がcanonical object・blob参照・抽出データを完全に整合させるかは未確認。 |
| P1 | 登録されたページ内容の抽出来歴 | 対応形式を過大表示するリスク | `registerObject` は呼び出し元が渡した `pages` を保存し、`extractorId: "builtin-extractor"`、`extractorVersion: "1.0.0"`、`status: "complete"` を記録する。一方、`src/index.ts` の実装済み既定抽出器はplain-textのみで、PDFは検出状態が `unverified`、PDF抽出器は登録されていない。ページが外部で抽出済みなのか、どの手段で得られたかを識別できないまま「complete」と記録しないよう、データ契約とAPI境界の整合が必要。 |
| P1 | Studio統合 | 未統合・置換禁止 | `docs/STUDIO-INTEGRATION-GAP-AUDIT.md` は現行Studioの `SharedWorkspaceDocStore` / `LocalSigmaDocStore` とCore adapterの契約が異なると記録。現時点でCoreを正本ストアへ直接切替しない。 |
| P2 | Blob reconciliation | PR上で提案、main未反映 | PR #17 は読み取り専用のblob整合性レポートとテストを追加するが、PRは未マージ。mainの `package.json` の `test` スクリプトには `tests/blob-reconciliation.test.ts` が含まれていない。PR #17 の採否とCIは別途管理する。 |
| P2 | バックアップ対象の説明と実装 | 文書/実装の差異を解消 | `src/services/backup-service.ts` のコメントは「Active and PendingDeletion」と説明するが、実際の一覧取得は `[\"Active\"]` のみ。削除待ちを除外する意図が正しいか、仕様決定とコメントを一致させる必要がある。 |
| P2 | mainの最新CI証拠 | 最新main SHAに紐づくrun未確認 | 現時点でmain先頭SHA `2461863a8571a7497ef81ad2dd4852a77913a6a4` に対するPRトリガーrunは取得できなかった。PR #17のheadに対するCI run 38967148373 と 38967207403 はNode 22/24とも成功。これはPR headの検証であり、現在のmainに対する新しいrunの代替とはしない。 |

## 詳細所見

### A. 端末同期の境界

確認したコード:
- `src/services/core-service.ts`: `syncDevice(auth, deviceId, userId, nowUtc)`
- `src/services/device-quarantine-service.ts`: `evaluateDeviceStatus`
- `src/persistence/core-repository.ts`: `updateDeviceSyncTime`

`syncDevice` は `AuthContext` を必須引数として受け取り、空の主体・空IDを拒否し、`auth.subjectId === userId` を検証してから既存端末の所有者を照合する。主体と `userId` の不一致は `AUTHENTICATED_USER_MISMATCH` で拒否し、既存端末の所有者不一致は `DEVICE_OWNER_MISMATCH` で拒否・監査記録を残す。受入テストには、未認証コンテキスト、偽装された `userId`、所有者不一致、空IDで端末が作成/更新されないことを追加した。

この修正はサービス内の主体結び付けを強化するが、`AuthContext` を作成するbootstrap/呼び出し元が信頼された認証主体に基づくことまでは保証しない。

**次の対応:** 全呼び出し元と起動/公開経路を確認し、`AuthContext` がどの信頼境界で生成されるかを特定する。端末の再登録/失効解除ルールは新しい設計判断を要するため、推測で追加しない。

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

## 追加確認（同ブランチのソース境界）

### D. Studio adapterから渡されるページデータ

追加で `src/adapters/sigma-studio-adapter.ts` を確認した。`SigmaStudioAdapter.addFiles()` は呼び出し元から受け取った `file.pages` を、そのまま `CoreService.registerObject()` の `pages` として渡している。従って、少なくともStudio adapter経由では、Core内の抽出器が当該ファイルを抽出した証拠がなくてもページ内容を登録できる。これは単に外部抽出を許可するかという仕様だけでなく、抽出元・抽出器・バージョン・信頼レベルをメタデータとして区別する必要があることを示す。

一方、既定抽出器は `src/index.ts` でplain-textのみ登録されている。現状のコードだけからPDFページをCoreが抽出しているとは判断できない。

**安全な対応案:** 既存adapterの互換性を保ちつつ、ページデータを「外部提供」として明示できる入力契約を追加する。Coreが実際に実行した抽出についてのみ、実際の抽出器ID・バージョン・成功ステータスを記録する。契約変更と移行方法を決めてから実装し、偽の抽出来歴を作らないテストを追加する。

### E. 端末同期・隔離データの呼び出し境界

`src/mcp/core-mcp-adapter.ts` と `src/mcp/stdio-server.ts` の登録ツールを確認した範囲では、`syncDevice()` と `quarantineData()` はMCPツールとして公開されていない。これはMCP経由の到達経路が見当たらないという限定的な確認であり、他のAPI、UI、内部呼び出し、将来のbootstrap経路が存在しないことを証明しない。

`syncDevice(auth, deviceId, userId)` はサービス内で認証コンテキストの存在と `auth.subjectId === userId` を検証するよう修正した。引き続き `AuthContext` の生成元が信頼できるか、外部公開経路がどこかを確認する必要がある。`quarantineData(auth, ...)` は認証主体、端末所有者、payloadのobjectId/Workspace scope、write権限を検証するよう修正した。未登録端末の暗黙作成も廃止した。

**次の対応:** リポジトリ内の全呼び出し元と起動/公開経路を調べる。未信頼入力から到達可能な場合は、認証済み主体と端末所有者の結び付け、および隔離データ登録の認可をサービス層または明確な信頼境界で強制する。所有者不一致、未認証呼び出し、失効端末、改ざんされたpayloadの負系テストを追加する。再登録・失効解除の仕様は推測で実装しない。

### F. バックアップ対象に関する実装確認

`src/services/backup-service.ts` のコメントは「Active and PendingDeletion」と記載するが、scope指定時も全体バックアップ時も `listSourceObjects(..., ["Active"])` のみを指定している。したがって、現行実装は `PendingDeletion` をエクスポートしていない。削除待ちを含めるかどうかは復元・削除保持の要件に関わるため、コメントだけを根拠に実装を変えず、要件決定後に実装・テスト・文書を同時にそろえる。

### G. MCP subprocessテストの到達範囲

`package.json` は `tests/mcp-stdio-subprocess.test.ts` をCIのテスト対象に含める。`src/mcp/stdio-entry.ts` と当該テストを確認したところ、実プロセス起動後にMCP初期化とツール一覧取得を行う試験はある。一方、テストを更新し、実プロセス経由で `core_list_sources` を呼び出してポリシーのないWorkspaceへのアクセスが拒否されること、および空のWorkspace IDがスキーマで拒否されることを検証するようにした。追加テストはGitHub Actionsで実行結果を確認する必要がある。認可許可ケース、Workspace越境の複数ユーザーケース、失効端末、タイムアウトやプロセス異常終了の動作はまだ証明していない。

stdioエントリーポイントは `SIGMA_CORE_SUBJECT_ID` 環境変数からsubject IDを読み取り、ツール引数からはidentityを受け取らない。この方式の安全性は、起動するホスト/親プロセスがその環境変数を信頼できる主体に限定することが前提になる。環境変数の値が誰によって設定されるか、MCPサーバーを起動できる利用者の権限を、実際の配布・起動境界で確認する必要がある。

**次の対応:** 実MCPクライアントから少なくとも、許可されたWorkspaceでの読み取り、権限のないWorkspaceへの拒否、書き込み権限なしの変更拒否、無効引数の拒否を実行し、期待結果と監査記録を検証する。必要に応じてクライアント切断、サーバー終了、タイムアウトの試験を追加する。

### H. 隔離データ復旧の完全性（追加確認）

`DeviceQuarantineService.recoverQuarantineItem()` は、期限・削除tombstone等を確認した後、隔離項目を `Recovering` に遷移させ、その後に `payload.object` があれば `saveSourceObject()` でSourceObjectだけを書き込み、`Recovered` に遷移させる。

静的に確認できるリスク:
- 復旧処理では `BlobReference`、blob本体、抽出Artifact、SourceLocationを復元していない。したがって、payloadがobject metadataのみの場合、ActiveなSourceObjectが存在しても元ファイルのbytesや検索用ページ内容が復元されない可能性がある。
- 既存canonical objectが `Active` の場合、明示的な競合拒否がなく、payloadのSourceObjectで上書きする経路がある。版・内容ハッシュ・更新時刻の競合ポリシーが必要。
- `Recovering` への遷移後に保存処理が例外になった場合、状態を `Quarantined` に戻す補償処理はこのメソッド内にない。再試行可能性を別途検証する必要がある。

この所見は静的コード確認であり、障害注入による再現試験はまだ実施していない。blob/Artifact/Locationを含む隔離payloadの正式なデータ契約も確認できていないため、推測でpayload形式を作ったり、復旧仕様を変更したりはしない。

**次の対応:** 隔離payloadのデータ契約と競合時の期待動作を確定し、復旧を一つの整合性境界として実装する。成功時に原本bytes・BlobReference・Artifact/Locationの整合性を検証し、Active objectとの競合、削除tombstone、期限切れ、保存途中の例外、再試行をテストする。仕様確定までは、Studio統合の完了条件に復旧機能を数えない。

## 推奨実施順

1. **隔離復旧の完全性:** 復旧がcanonical objectだけでなくblob参照・抽出データも整合するか確認し、部分的/不正payloadを拒否する。
2. **呼び出し境界の確認:** `syncDevice` と `quarantineData` の全呼び出し元・公開経路、および `AuthContext` の生成元を調査する。
3. **MCP subprocessの実動作確認:** 実プロセスからのツール呼び出しに対する拒否・スキーマ検証のCI結果を確認し、認可許可ケースと複数Workspace/主体の試験を追加する。
4. **抽出来歴の修正設計:** Core自身が抽出したデータと、外部から提供されたページデータを区別するデータ契約を決める。
5. **Blob reconciliation PR #17:** 差分・CI・副作用のないことをレビューし、別途採否を決定する。
6. **バックアップ対象仕様:** PendingDeletionを含めるべきかを決定し、実装・コメント・テストを一致させる。
7. 上記の変更後、Node 22/24でCIを再実行し、失敗した場合はログを確認する。
8. その後にPDF抽出、追加の実MCPプロセス、復元試験、Electron配布試験へ進む。

## 現時点の結論

CoreにはSQLite永続化、FTS検索、認可サービス、バックアップ/復元、MCP adapterなどの実装がある。ただし、ファイル抽出の来歴、端末同期の信頼境界、Studioのストア契約、mainでのCI証拠は追加検証が必要。**この監査は静的コード確認であり、上記のリスクが動的試験で再現したとはまだ判定していない。**

## Follow-up implementation review (2026-10-18)

This section supersedes the relevant "next action" statements above where changes are now implemented on PR #18. Earlier findings remain as historical observations of the code before those changes.

### Changes now present on PR #18

- `src/extraction.ts` now owns the format detection and extraction implementation; `src/index.ts` re-exports it to preserve the package entrypoint.
- `CoreService.registerObject()` runs the registered extractor when the caller omits page data. Valid UTF-8 plain text is indexed automatically as `builtin-plain-text`. PDF is still not extracted automatically.
- Page data supplied by the caller/adapter is labeled `caller-provided-pages` with version `external-1` rather than falsely attributing it to `builtin-extractor`.
- Quarantine recovery now refuses to overwrite an existing canonical object and wraps the SQLite state transition plus SourceObject write in a repository transaction. A regression test covers the existing-object conflict.

### Verification state

- GitHub Actions run [39079820471](https://github.com/nishida0402shun-dev/SIGMA-Core/actions/runs/39079820471): Node.js 22 job completed successfully, including dependency audit, license inventory, unit tests, and type-check. Node.js 24 was still in progress at the time of this note.
- The Node.js 22 result is tied to commit `0fe7d3542a7bbd47161666147415a1e0da6fb68a`; do not treat it as proof of Electron/OS runtime behavior.

### Remaining release blockers

- Quarantine recovery is **not production-complete**: the current payload/recovery path still does not restore or validate original blob bytes, BlobReference, extracted artifacts, and SourceLocations as a single consistent unit. The new transaction only makes the current metadata writes atomic; it does not solve the missing blob/artifact contract.
- `AuthContext` still depends on a trusted host/bootstrap boundary; all real call paths and deployment identity configuration need verification.
- PDF extraction, page/region provenance, backup/restore fault-injection tests, Electron packaging, and Studio read-only integration PoC remain unverified.
- PR #18 remains unmerged. Studio's existing store has not been replaced.

## Quarantine recovery follow-up (2026-10-18)

The recovery path has been extended beyond metadata-only restoration:

- Recovery now requires `bytesBase64` in the quarantine payload and validates canonical Base64, byte length, source version, and SHA-256 before canonical commit.
- The target Workspace must exist and the caller must have write permission.
- The immutable original bytes are staged in `LocalBlobStore`; the transaction commits `SourceObject`, `BlobReference`, extracted artifact/locations (when available), and quarantine status together.
- A payload with metadata but no original bytes is rejected. Tests cover successful byte restoration, metadata-only fail-closed behavior, and injected extraction-persistence failure proving that canonical SQLite rows and quarantine status roll back together.
- Conflict/tombstone checks are re-evaluated inside the SQLite transaction to reduce races with concurrent recovery or registration.

Limitations remain: filesystem writes cannot roll back with SQLite, so a failed DB commit may leave an unreferenced content-addressed blob for later reconciliation. Recovery is not considered fully verified until CI passes on the latest code commit and the failure paths are exercised. PDF extraction remains unsupported; recovery of PDF bytes does not imply that PDF text or page provenance has been extracted.


### CI follow-up

A CI run initially caught a syntax issue after the expiry test began awaiting the now-asynchronous recovery API. The test was corrected to be async. A fresh CI run for the follow-up rollback test is queued; do not report the latest code as passing until that run completes.

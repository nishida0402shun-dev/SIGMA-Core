# SIGMA Core 要件ベースライン（原本消失後の再構成）

**作成日:** 2026-10-17  
**版:** 0.2-reconstructed  
**状態:** 再構成案。ユーザー承認前の項目を含む。  
**重要:** これは失われた「SIGMA Core 要件定義書 Version 0.1」の復元物ではなく、現存するリポジトリ文書と記録済みの開発方針から再構成した新しいベースラインである。原本と同一であるとは主張しない。

## 1. 目的と証拠の分類

SIGMA CoreをSIGMA Studio専用の内部機能として新規構築し、既存Studio機能を維持しながら、安全なデータ管理、ファイル内容の抽出・検索、AI/MCP/Skills連携、復旧可能性を段階的に検証する。

本書では要求の根拠を次のように分類する。
- **A — 既存方針で明示:** docs/DECISIONS.md、docs/DATA_CONTRACT.md、docs/STUDIO-INTEGRATION-GAP-AUDIT.md、および記録済みの開発方針で明示されている。
- **B — 既存文書にある設計目標:** docs/ARCHITECTURE.md や docs/MVP_SCOPE.md にあるが、文書自体が概念設計・未承認提案と明記している。自動的に承認済み要求とはしない。
- **C — 新規提案:** 実装計画を具体化するためにこの文書で提案する。承認されるまでは確定要件として扱わない。
- **実装状態:** 要件の存在と実装完了を区別し、コード・テスト・CI・対象ランタイムの証拠で判定する。

## 2. 明示済み方針（A）

| ID | 要件ベースライン | 根拠 |
|---|---|---|
| CORE-A01 | SIGMA Coreは新規実装とし、旧式SIGMACoreやknowledgeDBを基盤として引き継がない | docs/DECISIONS.md、開発引き継ぎ方針 |
| CORE-A02 | 初期の製品境界はSIGMA Studio専用の内部機能とする | docs/DECISIONS.md |
| CORE-A03 | 正本DBは共通利用を基本とし、WorkspaceごとにDBを分割しない | docs/DECISIONS.md、docs/DATA_CONTRACT.md |
| CORE-A04 | Workspaceを暗黙に自動選択せず、ユーザーが選択する | docs/DECISIONS.md、開発引き継ぎ方針 |
| CORE-A05 | 原本ファイル、原本に忠実な抽出、AI整理情報、学習コンテンツを別カテゴリとして保持し、相互の由来を追跡する | docs/DECISIONS.md、docs/ARCHITECTURE.md |
| CORE-A06 | ファイルは保存できるだけでは対応と判定せず、対象操作に対する内容認識・解析能力と検証根拠で判定する | docs/DECISIONS.md |
| CORE-A07 | UI、CLI AI、Web AI、MCP、Skillsは共通サービス層を介してCore操作を行い、アダプターからDBへ直接アクセスしない | docs/DECISIONS.md、docs/ARCHITECTURE.md |
| CORE-A08 | 認証と認可を区別し、操作単位の共通認可と連携先ごとの公開範囲を設ける | docs/DECISIONS.md |
| CORE-A09 | 元ファイルの変更・削除は影響を説明し、明示承認を得る。登録済みデータの削除を暗黙に連鎖させない | docs/DECISIONS.md |
| CORE-A10 | 重要な承認、登録、破壊的変更、権限変更、品質状態の変化、復旧操作は監査対象とする | docs/DECISIONS.md |
| CORE-A11 | バックアップ作成の成功と復元可能性を別々に検証する | docs/DECISIONS.md |
| CORE-A12 | 大きな設計変更は選択肢・影響・代替案を提示して承認を得る。提案・実装・テスト済みを区別する | 開発作業方針、docs/DECISIONS.md |

## 3. 既存文書にある設計目標（B：承認・実装の再確認が必要）

| ID | 目標 | 根拠・注意 |
|---|---|---|
| CORE-B01 | キーワード全文検索、意味検索、構造/関係検索、原本への追跡を共通検索として提供する | docs/DECISIONS.md。検索方式・DB選定は未決 |
| CORE-B02 | AIとユーザーが処理計画を作成し、実行前に手順・影響を確認する | docs/DECISIONS.md、docs/ARCHITECTURE.md |
| CORE-B03 | 計画承認と、生成内容の正式登録承認を分離する | docs/DECISIONS.md |
| CORE-B04 | 原本変更時に下流データへの影響を分類し、登録済み内容の変更前に承認を得る | docs/DECISIONS.md |
| CORE-B05 | 中断処理、タイムアウト、再試行、競合検出、重複登録防止、復旧を共通方針で扱う | docs/DECISIONS.md |
| CORE-B06 | 全体・カテゴリ・単一レコードの復元、段階的マイグレーション、復元検証を支援する | docs/DECISIONS.md |
| CORE-B07 | PDFを含むファイルから部分情報を取得し、対応する場合はページ/領域の出典位置を保持する | docs/ARCHITECTURE.md。PDF実装・位置追跡は未完了 |
| CORE-B08 | 学習用問題・解答・説明等を原本とリンクして管理できるようにする | docs/ARCHITECTURE.md、プロジェクト方針。Question Engineの詳細要件は別途具体化が必要 |
| CORE-B09 | 一時中間成果物の保持目標を7日とし、通知とユーザーの選択を考慮する | docs/DECISIONS.md。起算点・期限後の挙動は未決 |
| CORE-B10 | 診断情報は実行可能な説明を優先し、権限に配慮して秘密情報をマスクする | docs/DECISIONS.md |

## 4. 実装前に決定・承認が必要な項目（C）

| ID | 決定事項 | 承認前の扱い |
|---|---|---|
| CORE-C01 | 言語/runtime/frameworkと配布対象OS | 現行コード・CIで確認できる範囲以上をサポート済みと主張しない |
| CORE-C02 | 正本DB、検索方式、ベクトル/Embeddingの採否 | SQLiteは実装スパイクとして扱い、最終決定とみなさない |
| CORE-C03 | 対応形式×操作の一覧、精度基準、最大サイズ、OCR、表・画像対応 | 形式ごとに検証されるまで未検証と表示する |
| CORE-C04 | subject identity、ユーザー/connector identity、役割、権限管理者 | identity bridgeと権限モデル確定前にStudio本番の書き込みを公開しない |
| CORE-C05 | バックアップ頻度、保持世代、保存先、暗号化、復旧目標 | 実装の有無・保護水準を要件確定前に断定しない |
| CORE-C06 | 端末失効/隔離時に許可・拒否する各操作 | 操作マトリクスと失効モデルの確定が必要 |
| CORE-C07 | 性能目標、代表データ量、対応ハードウェア | 測定条件なしに性能保証値を設定しない |
| CORE-C08 | 移行パッケージ、互換性、エクスポート形式、切り戻し手順 | Studioの既存ストアを置換しない |
| CORE-C09 | AIプロバイダー別能力、データ送信、プロンプトインジェクション防御、MCP公開範囲 | プロバイダーやコネクターごとに実際の能力・信頼境界を検証する |
| CORE-C10 | Question Engine / StudyAidの問題形式、採点、出典、品質閾値 | 問題バンクの詳細仕様と評価基準は別途承認する |

## 5. 実装・検証の共通ルール

1. 各要件に、コード/サービス、権限境界、正系テスト、負系/異常系テスト、CI実行を紐付ける。
2. 状態は最低限、未着手、実装中、実装済み・未検証、テスト済み、CI確認済み、対象配布環境で検証済み、ブロック中に分ける。
3. テストが存在するだけでは成功と判定しない。実行結果を記録する。
4. 要件の出典がA/B/Cのどれかを保持し、新規提案を過去の合意や消失した原本の内容として扱わない。
5. 要件変更は差分、理由、影響、承認状態を記録する。
6. 不明な挙動を推測で補完せず、未確定事項として記録する。

## 6. 既存AT-001〜AT-023の扱い

旧原本が存在しないため、旧AT番号の正式な意味を現存文書だけから完全に復元できるとは限らない。過去のテストに残っているAT番号は履歴情報として保持するが、正式な意味を確認できない番号に新しい意味を割り当てない。

新しい追跡表では CORE-Axx / CORE-Bxx / CORE-Cxx を使用し、旧ATとの対応が根拠をもって確認できる場合のみ対応関係を記録する。旧AT-008/011/019/021/023は、対応関係が確定するまで旧番号として意味未確認とする。

## 7. 参照文書

- docs/DECISIONS.md
- docs/ARCHITECTURE.md
- docs/MVP_SCOPE.md
- docs/DATA_CONTRACT.md
- docs/ACCEPTANCE_CRITERIA_TRACEABILITY.md
- docs/STUDIO-INTEGRATION-GAP-AUDIT.md
- docs/DEVELOPMENT_PLAN.md

このベースラインは新しい作業基準を作るための再構成案であり、原本の復元物ではない。未決事項を確定要件へ昇格させる際は、根拠と承認状態を記録する。
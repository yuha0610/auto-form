# 資金調達情報の最新化 設計

## 背景・目的

対象企業リスト(スプレッドシート、1454行)の「資金調達額」「企業ラウンド」「資金調達月」は行追加時点の情報のままになっており、その後さらに資金調達を行った企業の情報が古いままになっているケースがある。営業リストの質を上げるため、全社について最新の資金調達情報を調べ直し、シートに反映する。

これは`2026-07-20-sheet-company-name-cleanup-design.md`で触れた3つの独立作業のうち③(2026年以降の新規資金調達企業の追加)とは異なる作業であり、**既存行の資金調達情報を最新化する**ことが目的(新規企業の発掘・追加は対象外)。

## スコープ

- 対象: シート全1454行(絞り込みは行わない)
- 更新対象列: 資金調達額 / 企業ラウンド / 資金調達月 / PRTimes URL
- 対象外: 上記4列以外の更新、新規企業の追加、行の削除

## アーキテクチャ

既存の`cleanupCompanyData.ts`と同じ思想で、**調査(高コスト)**と**反映(軽量・安全にリトライ可能)**を分離する。

```
[調査フェーズ] Workflowツール(1454社をpipelineで並列処理)
   │ 各社: Web検索エージェント1体が
   │  - 既存の資金調達額/ラウンド/月/PRTimes URLを判断材料として受け取る
   │  - Web検索で現在より新しい資金調達ラウンドがないか確認
   │  - 額・ラウンド・時期・情報源URL・確信度(high/low)・理由を返す
   ▼
data/funding-research-results.json (調査結果を保存)
   ▼
[反映フェーズ] scripts/updateFundingInfo.ts
   │ ドライラン(既定): 更新候補一覧・要目視確認一覧をレポート出力のみ
   │ --apply: 書き込み直前にシート現在値を再取得し、
   │          JSON生成時から変わっていなければ4列を書き込む
   ▼
Googleスプレッドシート
```

## 調査フェーズの詳細

- 実行主体: Workflowツール(`pipeline`で1454社を並列処理、ユーザーが明示的にオーケストレーション利用に同意済み)
- 各社1エージェント呼び出し。プロンプトには企業名・既存の資金調達額/ラウンド/月/PRTimes URLを渡す
- エージェントの出力(構造化):

```ts
interface FundingResearchResult {
  rowIndex: number;
  companyName: string;
  found: boolean;              // 検索で何らかの資金調達情報が得られたか
  updateCandidate: boolean;    // 既存値と異なる高確信度の情報があるか
  fundingAmount?: string;
  fundingRound?: string;
  fundingMonth?: string;
  sourceUrl?: string;
  confidence: "high" | "low";
  reason: string;              // 判定理由(要目視確認の場合に人が読む)
}
```

- 判定基準:
  - 複数ソースが一致し、既存値より新しいラウンドが明確に確認できる → `confidence: "high"`, `updateCandidate: true`
  - 情報が見つからない、複数ソースが矛盾する、既存値と同じ内容しか見つからない → `updateCandidate: false`(見つからず/変更なしは要目視確認とは別に「変更なし」として区別してレポートする)
  - 見つかったが確信が持てない(単一の弱いソースのみ等) → `confidence: "low"`, `updateCandidate: false`、要目視確認に回す
- 全結果を配列でWorkflowの戻り値とし、実行後に`data/funding-research-results.json`として保存する

## データモデルの変更

`src/types.ts`の`COLUMNS`/`SheetRowData`に以下を追加する(既存の`email`列と同じ要領):

```ts
export const COLUMNS = {
  // ...既存列
  fundingAmount: "資金調達額",
  fundingRound: "企業ラウンド",
  fundingMonth: "資金調達月",
  prTimesUrl: "PRTimes URL",
} as const;

export interface SheetRowData {
  // ...既存フィールド
  fundingAmount: string;
  fundingRound: string;
  fundingMonth: string;
  prTimesUrl: string;
}
```

`src/lib/sheetData.ts`の`parseSheetRows`にもこの4列の読み取りを追加する。

## 反映スクリプト(`scripts/updateFundingInfo.ts`)

```
tsx scripts/updateFundingInfo.ts                # ドライラン
tsx scripts/updateFundingInfo.ts --apply        # 書き込み実行
```

- `data/funding-research-results.json`を読み込み、`fetchSheetData`→`parseSheetRows`で現在のシート値も取得する
- ドライラン出力:
  - 「更新候補」一覧: 行番号・企業名・変更前後の4項目・情報源URL
  - 「要目視確認」一覧: 行番号・企業名・理由(`confidence: low`または矛盾)
  - 「変更なし/情報見つからず」件数のサマリのみ(一覧は出さない、件数把握のため)
- `--apply`指定時:
  - `updateCandidate: true`の行についてのみ、書き込み直前にシートの現在値を再取得
  - JSON生成時点の既存値と現在のシート値が一致する場合のみ4列を書き込む(手動編集などで既に変わっていた場合はスキップし、警告として一覧に出す)

## エラーハンドリング

- Web検索エージェントが例外を返す/失敗する → その行は`confidence: "low"`, `reason: "調査失敗"`として要目視確認に回し、全体の処理は継続する(`cleanupCompanyData.ts`のFable判定失敗時と同方針)
- Sheets APIへの書き込み失敗 → どこまで書き込めたかをコンソールに出力してスクリプトを終了する(部分適用を明示。自動リトライは行わない)

## テスト方針

- `data/funding-research-results.json`とシート現在値の突き合わせロジック(一致/不一致判定、スキップ判定)のユニットテスト
- ドライラン時のレポート分類(更新候補/要目視確認/変更なし)のユニットテスト
- Web検索エージェントの判定精度そのものは自動テスト対象外(既存のFable判定と同様、Workflow実行後の結果を少数件目視確認して代替する)

## スコープ外(今回は対象としない)

- アポ(商談)獲得理由の言語化(別途ブレスト・別設計とする)
- 2026年以降の新規資金調達企業の発掘・追加
- 資金調達額・ラウンド・月・PRTimes URL以外の列の更新
- 調査フェーズ(Workflow)の定期自動実行化(今回は一回限りの一括更新)

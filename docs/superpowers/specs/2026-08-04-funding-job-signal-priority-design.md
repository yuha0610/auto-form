# 資金調達・求人シグナル検知による優先送信 設計

## 背景・目的

フォーム営業は資金調達直後・求人掲載直後など「企業が動き出したタイミング」に送るほど反応が良くなりやすい。現状はそうした動きを検知する仕組みがなく、`updateFundingInfo.ts`による資金調達情報の更新も「既存行の情報を後から埋める」だけで、営業タイミングには一切連動していない。

本設計では、資金調達・求人の新規動きを検知し、(1)既存シート企業への優先フラグ付け、(2)まだシートにない新規企業の発掘・追加、の両方を行い、次回の送信バッチで優先的に処理されるようにする。

`2026-07-29-funding-info-update-design.md`で対象外とされた「新規資金調達企業の発掘・追加」を含む後続作業にあたる。

## スコープ

- 検知シグナル: 資金調達ニュース、求人の新規掲載
- 対象: シート上の既存企業(優先フラグ付け) + Web上の新規企業(発掘・追加)
- アクション: 検知結果をシートに反映し、次回送信バッチで優先的に選ばれるようにする(自動での即時送信ではなく、次回実行時の優先順位づけ)
- 対象外:
  - リアルタイム監視(cron等での自動実行) — 今回は人が定期的にWorkflowを実行する運用
  - 検知によるフォローアップ間隔(14日)のバイパス・前倒し送信
  - 求人媒体・PR Times以外の情報源の統合(Workflow内のWeb検索エージェントの裁量に委ねる)

## アーキテクチャ

`updateFundingInfo.ts`と同じ「調査(Workflow)」と「反映(スクリプト)」を分離する構成を踏襲する。

```
[調査フェーズ] Workflowツール
   │ 既存企業: 資金調達/求人の新規動きがないか確認
   │ 新規発掘: Web検索で資金調達/求人が話題の未収録企業を探す
   ▼
data/signal-research-results.json (調査結果を保存)
   ▼
[反映フェーズ] scripts/applySignals.ts
   │ ドライラン(既定): 更新候補・追加候補・要確認一覧をレポート出力のみ
   │ --apply: 書き込み直前にシート現在値を再取得し、
   │          既存企業は差分ガード付きで検知シグナル列を更新
   │          新規企業は重複・競合・非スタートアップ判定を通過したものだけ行を追加
   ▼
Googleスプレッドシート
   ▼
次回 tsx src/index.ts 実行時、selectBatchが検知シグナルありを優先して選択
```

## 調査フェーズの詳細

- 実行主体: Workflowツール(人が定期的に実行。自動cron化は対象外)
- 出力(構造化):

```ts
interface ExistingSignal {
  rowIndex: number;
  companyName: string;
  signalType: "資金調達" | "求人";
  signalDate: string;       // YYYY/MM/DD
  sourceUrl: string;
  confidence: "high" | "low";
  reason: string;
}

interface NewCandidate {
  companyName: string;
  companyUrl: string;
  signalType: "資金調達" | "求人";
  signalDate: string;
  sourceUrl: string;
  confidence: "high" | "low";
  reason: string;
}

interface SignalResearchResult {
  existingSignals: ExistingSignal[];
  newCandidates: NewCandidate[];
}
```

- 判定基準は`updateFundingInfo.ts`の資金調達判定と同方針: 複数ソースが一致し明確に確認できる場合のみ`confidence: "high"`。単一の弱いソースや矛盾がある場合は`confidence: "low"`として要確認に回す。
- 全結果を`data/signal-research-results.json`として保存する。

## データモデルの変更

`src/types.ts`の`COLUMNS`/`SheetRowData`に追加:

```ts
export const COLUMNS = {
  // ...既存列
  signalType: "検知シグナル種別",
  signalDate: "検知日",
  signalSourceUrl: "検知元URL",
} as const;

export interface SheetRowData {
  // ...既存フィールド
  signalType: string;
  signalDate: string | null;
  signalSourceUrl: string;
}
```

`src/lib/sheetData.ts`の`parseSheetRows`にこの3列の読み取りを追加する。

`src/lib/targetSelection.ts`の`FOLLOW_UP_INTERVAL_DAYS`を`30`→`14`に変更する(検知シグナルの有無に関わらず全企業に適用する基本ルールの変更)。

## 優先送信ロジック

`targetSelection.ts`に追加:

```ts
function hasRecentSignal(row: SheetRowData, today: Date): boolean {
  const signalDate = parseSheetDate(row.signalDate);
  if (!signalDate) return false;
  return daysBetween(signalDate, today) <= FOLLOW_UP_INTERVAL_DAYS;
}
```

`selectBatch`は、`getNextAttempt`で選ばれた対象を「`hasRecentSignal`がtrueのもの→それ以外」の順に安定ソートしてから返す(対象件数の絞り込みロジック自体は変更しない)。これにより`index.ts`側で`desiredBatchSize`によりタブ数を絞る際、検知シグナルのある企業が優先的に処理される。

シグナルの有効期間は`FOLLOW_UP_INTERVAL_DAYS`(14日)を流用し、専用の定数は追加しない。

## 反映スクリプト(`scripts/applySignals.ts`)

新規ライブラリ`src/lib/signalDetection.ts`に以下の純粋関数を実装し、スクリプトから呼び出す。

```
tsx scripts/applySignals.ts                # ドライラン
tsx scripts/applySignals.ts --apply        # 書き込み実行
```

### 既存企業への反映(`classifyExistingSignals`)

`ExistingSignal[]`とシート現在行を突き合わせ、`classifyFundingResults`と同じ順序で判定する:

1. `confidence: "low"` → 要確認(理由は`reason`)
2. 該当`rowIndex`がシート上に無い、または現在の企業名と一致しない → `staleSkip`
3. 現在シートの`検知日`が、検知結果の`signalDate`と同じかそれより新しい → 変更なし(重複適用を防ぐ)
4. 上記以外(未検知 or 検知結果の方が新しい) → 更新候補として`検知シグナル種別`/`検知日`/`検知元URL`の3列を書き込み対象にする

### 新規企業の発掘・審査(`screenAndBuildNewRows`)

`NewCandidate[]`それぞれについて:

1. `confidence: "low"`のものは、既存企業のシグナル判定と同様にそのまま要確認へ(理由は調査結果の`reason`)。
2. `extractCompanyCoreName`(`textNormalize.ts`)で正規化し、既存シートの全企業名と比較。一致するものがあれば重複として要確認へ。
3. `competitorScreening.ts`の`matchCompanyName`/`matchPageContent`、`nonStartupScreening.ts`の同名関数(インポート時にエイリアスして名前衝突を避ける)を企業名・企業URLの取得テキストに適用。ヒットしたら除外し、理由付きで要確認へ。
4. 上記すべてを通過した候補のみ、新規行データ(企業名・企業URL・検知シグナル3列。他列は空欄)に変換する。

### シートへの追加

`src/lib/sheetsClient.ts`に`appendRows`を追加し、Sheets APIの`spreadsheets.values.append`でシート末尾に新規行を追加する(既存の`writeCells`/`deleteRows`と同様の薄いラッパー)。

### ドライラン出力

- 「既存企業・更新候補」: 行番号・企業名・シグナル種別・検知日・URL
- 「新規追加候補」: 企業名・企業URL・シグナル種別・検知日・URL
- 「要確認」: 重複/競合/非スタートアップ判定でフィルタされたもの(理由付き)
- 「変更なし」: 件数のみ

## エラーハンドリング

- Web検索エージェントが失敗する → `confidence: "low"`, `reason: "調査失敗"`として要確認に回し、処理は継続する
- `--apply`時、既存企業への書き込み直前にシート現在値を再取得し、取得時点のスナップショットと一致する場合のみ書き込む(手動編集等で既に変わっていた場合はスキップし、要確認一覧に出す)
- 新規行の追加(`appendRows`)が途中で失敗した場合 → どこまで追加できたかをコンソールに出力してスクリプトを終了する(部分適用を明示、自動リトライなし)

## テスト方針

- `targetSelection.test.ts`: `FOLLOW_UP_INTERVAL_DAYS`変更に伴う既存テスト(30日基準)を14日基準に更新。`hasRecentSignal`、および`selectBatch`が検知シグナルありを先頭に並べ替えることの新規テストを追加。
- 新規`tests/signalDetection.test.ts`(`fundingUpdate.test.ts`と同構成):
  - 既存企業への書き込み判定(row drift検知・検知日が新しい場合のみ上書き)
  - 新規企業の重複検知(表記ゆれを含む)、競合/非スタートアップ判定によるフィルタ
  - 新規行データの組み立て(ヘッダー順への値マッピング)
- `sheetsClient.ts`の`appendRows`自体は、既存の`writeCells`/`deleteRows`と同様に単体テスト対象外(実APIを叩く薄いラッパーのため)。判定ロジックは全て純粋関数側でテストする。
- Web検索エージェントの検知精度そのものは自動テスト対象外(Workflow実行後の結果を少数件目視確認して代替する)。

## スコープ外(今回は対象としない)

- リアルタイム監視・cronによる自動実行化(今回は人が定期的にWorkflowを実行する運用)
- 検知シグナルによるフォローアップ間隔(14日)のバイパス・前倒し送信
- 求人媒体・PR Times以外の情報源をコードレベルで統合すること(Web検索エージェントの裁量に委ねる)
- 検知シグナル列の"消費済み"管理(古い検知は14日経過で自然に優先度が外れる仕様とし、明示的なフラグ管理は行わない)

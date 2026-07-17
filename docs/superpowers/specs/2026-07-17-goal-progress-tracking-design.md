# 目標件数・進捗管理 設計

## 背景

「残り10営業日で1000件のフォーム営業を達成する」のような目標を立てても、現状はスプレッドシートを自分で見て累計件数・残り営業日・必要ペースを都度手計算する必要があり、手間になっている。既存の「今日の送信件数をSlackに通知する」仕組み([[2026-07-13-slack-daily-count-notify-design.md]])に、目標に対する進捗を追記して自動で分かるようにする。

## 目標の設定場所

スプレッドシートに新規シート「進捗」を追加し、以下のセルで目標を管理する(ユーザーがセルを直接書き換えるだけで目標を変更できる)。

| セル | 内容 | 例 |
|---|---|---|
| A1 | ラベル「目標件数」 | 目標件数 |
| B1 | 目標件数(数値) | 1000 |
| A2 | ラベル「期限」 | 期限 |
| B2 | 期限日付(`YYYY/MM/DD`) | 2026/07/31 |

B1・B2が空、またはパース不能な値の場合は「目標未設定」として扱い、進捗通知自体をスキップする(既存の「今日の送信件数」通知は今まで通り送る)。

## 集計方法

- **累計件数**: 「フォーム営業 1回目」列が空でない行数。フォローアップ(2回目・3回目)は目標のカウント対象外(目標は「新規1000社にアプローチする」ことなので)。
- **残り営業日**: 今日を含まず、翌日から期限日当日までのうち土日を除いた日数。日本の祝日は考慮しない(土日のみ除外)。期限が今日以前の場合は`0`とする。
- **必要ペース**: `(目標件数 - 累計件数) / 残り営業日`を切り上げた1日あたりの件数。

## 変更1: 新規ファイル `src/lib/progressGoal.ts`

```ts
export interface Goal {
  targetCount: number;
  deadline: Date;
}

export async function fetchGoal(
  client: sheets_v4.Sheets,
  spreadsheetId: string,
): Promise<Goal | null>

export function parseGoal(targetCountRaw: string, deadlineRaw: string): Goal | null

export function countFirstSent(rows: SheetRowData[]): number

export function countRemainingBusinessDays(today: Date, deadline: Date): number

export function buildProgressMessage(
  totalSent: number,
  goal: Goal,
  remainingBusinessDays: number,
): string
```

- `fetchGoal`: 「進捗」シートのB1・B2を読み取り、`parseGoal`に渡す。シート自体が存在しない場合(`spreadsheets.get`でシート一覧に「進捗」が見つからない、または値取得がエラーになる場合)は`null`を返す。Google Sheets APIへの実アクセスを伴うため、ユニットテスト対象外とする(`sheetsClient.ts`と同じ方針)。手動確認のみ行う。
- `parseGoal`: 純粋関数。`targetCountRaw`が正の整数としてパースできない、または`deadlineRaw`が有効な日付としてパースできない場合は`null`を返す。日付パースは既存の`parseSheetDate`(`src/lib/targetSelection.ts`)を再利用する。
- `countFirstSent`: 純粋関数。`row.firstSentAt`が`null`または空文字(トリム後)でない行数を数える。
- `countRemainingBusinessDays`: 純粋関数。`today`の翌日から`deadline`当日までを1日ずつ数え、曜日が土・日でない日をカウントする。`deadline`が`today`以前の場合は`0`を返す。
- `buildProgressMessage`: 純粋関数。以下の3パターンの文言を返す。
  - 通常時:
    ```
    累計(1回目): 156件 / 目標1000件(残り844件)
    残り営業日: 9日
    必要ペース: 94件/日
    ```
  - 目標達成済み(`totalSent >= targetCount`):
    ```
    累計(1回目): 1020件 / 目標1000件 達成済み🎉
    ```
  - 期限切れ・当日で残り営業日が0だが未達成(`remainingBusinessDays === 0 && totalSent < targetCount`):
    ```
    累計(1回目): 800件 / 目標1000件(残り200件)
    期限(2026/07/31)を過ぎています
    ```

## 変更2: `src/lib/slackNotify.ts` のリファクタリング

現在`notifySlackDailyCount`内にベタ書きされているSlack POST処理を汎用関数`notifySlackText(text: string): Promise<void>`として切り出し、`notifySlackDailyCount`はこれを呼ぶだけにする。新しい進捗通知もこの`notifySlackText`を再利用する。

```ts
export async function notifySlackText(text: string): Promise<void>
export async function notifySlackDailyCount(count: number): Promise<void> // 内部でnotifySlackText(buildSlackPayload(count).text)を呼ぶ
```

失敗時(Webhook URL未設定・HTTPエラー・例外)に`console.warn`のみで例外を投げない既存の耐障害方針は`notifySlackText`にそのまま引き継ぐ。

## 変更3: `src/index.ts` の変更

既存の「今日の送信件数」通知(`notifySlackDailyCount`呼び出し)の直後、同じtry/catchブロック内に以下を追加する。

```ts
const goal = await fetchGoal(sheetsClient, spreadsheetId);
if (goal) {
  const totalSent = countFirstSent(countRows);
  const remainingBusinessDays = countRemainingBusinessDays(new Date(), goal.deadline);
  await notifySlackText(buildProgressMessage(totalSent, goal, remainingBusinessDays));
}
```

`countRows`は既存コードで直前に取得済みの最新スプレッドシートデータをそのまま再利用する(再取得しない)。

エラーハンドリング:
- `fetchGoal`が`null`を返す(目標未設定) → 進捗通知はスキップ、既存の日次通知のみ送信
- `fetchGoal`が例外を投げる、または`notifySlackText`が失敗する → `console.warn`のみでバッチ全体は止めない

## 変更4: ドキュメント

READMEに以下を追記する:
- 「進捗」シートの追加方法とA1/B1/A2/B2のセル仕様
- 目標未設定時は進捗通知がスキップされる旨

## テスト

`tests/progressGoal.test.ts`を新規作成し、以下をユニットテストする(実HTTPアクセスを伴う`fetchGoal`・`notifySlackText`は対象外):

- `parseGoal`: 正常な数値・日付から`Goal`を組み立てること、目標件数が数値でない/0以下、期限日付がパース不能な場合に`null`を返すこと
- `countFirstSent`: 1回目列に値がある行だけカウントすること(空文字・空白のみは除外)
- `countRemainingBusinessDays`: 平日のみの期間で正しい日数になること、土日を挟む期間で正しく除外すること、期限が今日と同じ/今日より前の場合に`0`を返すこと
- `buildProgressMessage`: 通常時・達成済み・期限切れの3パターンの文言を確認すること

## スコープ外

- 日本の祝日を考慮した営業日計算
- フォローアップ(2回目・3回目)を含めた進捗カウント
- 独自の進捗確認コマンド(`npm run progress`等)や別スプレッドシートへの進捗自動書き込み
- 目標未達成が続いた場合のアラート強調(緊急度に応じた通知文言の変更など)

# 今日の送信件数をSlackに通知する 設計

## 背景

`npm run dev` はユーザーが手動で実行するCLIで、1日に複数回実行されることもある。実行のたびに「今日、合計で何件フォーム送信を試みたか」を自分でスプレッドシートから数える必要があり、手間になっている。バッチ実行の完了時に、その時点での「今日の累計送信数」をSlackへ自動通知することで、この手間をなくす。

メール通知は今回は対象外(SMTP等のセットアップコストが高いため)。Slack Incoming Webhookのみを使う。

## 通知先

Slack Incoming Webhookは作成時にSlack側で投稿先チャンネルを選ぶ仕組みのため、プログラム側でチャンネルを指定する必要はない。ユーザーがSlackで作成したWebhook URLを環境変数に設定するだけでよい。

## 集計方法

「今日送信した件数」は、スプレッドシートの「フォーム営業 1回目」「フォーム営業 2回目」「フォーム営業 3回目」列のいずれかに今日の日付が入っている行数と定義する。

バッチの書き込み処理(`writeCells` の成功パス、または失敗して `savePendingWrites` に回るパスのどちらを通っても)が完了した直後に、スプレッドシートをもう一度読み直して集計する。こうすることで:

- 書き込みが成功していれば、今回のバッチ分も含めた最新の累計が数えられる
- 書き込みが失敗してpending-writesに退避された場合は、まだスプレッドシートに反映されていないので、その分は含まれない(実態と一致する)

失敗件数や成功/保留の内訳は今回は含めない。「今日の累計送信数」のみを通知する。

## 変更1: 新規ファイル `src/lib/slackNotify.ts`

```ts
export function countSentToday(rows: SheetRowData[], today: Date): number
export function buildSlackPayload(count: number): { text: string }
export async function notifySlackDailyCount(count: number): Promise<void>
```

- `countSentToday(rows, today)`: 純粋関数。各行の `firstSentAt` / `secondSentAt` / `thirdSentAt`(いずれも `"YYYY/MM/DD"` 形式の文字列、または未設定なら空文字)を `parseSheetDate`(`src/lib/targetSelection.ts` に既存)でパースし、`today` と年月日が一致するものが1つでもあればその行を1件としてカウントする。
- `buildSlackPayload(count)`: 純粋関数。Slack Incoming Webhookが受け付けるJSON形式 `{ text: string }` を返す。本文は `` `今日の送信: ${count}件` ``。
- `notifySlackDailyCount(count)`:
  - `process.env.SLACK_WEBHOOK_URL` が未設定なら `console.warn` してno-op(何もPOSTしない)
  - 設定されていれば `fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(buildSlackPayload(count)) })` でPOSTする(Node.js組み込みの `fetch` を使う。Node 18+前提で、既存の `package.json` の `@types/node` ^22 なので問題ない)
  - レスポンスが失敗ステータスの場合、またはfetch自体が例外を投げた場合も、例外を投げずに `console.warn` するのみ(バッチ処理自体は止めない。`src/lib/notify.ts` の `notifyBatchReady` と同じ耐障害パターン)

## 変更2: `src/index.ts` の変更

書き込み処理(`writeCells` の try/catch ブロック)を抜けた直後、`finally { await browser.close(); }` の手前に以下を追加する:

```ts
const countRaw = await fetchSheetData(sheetsClient, spreadsheetId, sheetName);
const countRows = parseSheetRows(countRaw);
await notifySlackDailyCount(countSentToday(countRows, new Date()));
```

## 変更3: 環境変数・ドキュメント

- `.env.example` に `SLACK_WEBHOOK_URL=` を追加
- README に以下を追記:
  - Slackで「Incoming Webhooks」を有効化し、通知したいチャンネルを選んでWebhook URLを発行する手順への言及
  - 発行したURLを `.env` の `SLACK_WEBHOOK_URL` に設定する手順
  - `SLACK_WEBHOOK_URL` が未設定の場合はSlack通知がスキップされる旨

## テスト

- `tests/slackNotify.test.ts` を新規作成:
  - `countSentToday`: 今日の日付が1回目/2回目/3回目のいずれかに入っている行をカウントすること、今日以外の日付や空欄はカウントしないこと、複数列に今日の日付が入っていても二重カウントしないこと、を確認する
  - `buildSlackPayload`: 件数を含む `{ text: ... }` を返すことを確認する
  - `notifySlackDailyCount` の実際のHTTP送信部分はテストしない(`src/lib/notify.ts` の `notifyBatchReady` と同様の方針)

## スコープ外

- メール通知
- 失敗件数・成功/保留の内訳などの詳細情報
- 独自の集計コマンド(`npm run report` 等)
- 通知先チャンネルの動的な切り替え(Webhook URLは1つ、チャンネルは固定)

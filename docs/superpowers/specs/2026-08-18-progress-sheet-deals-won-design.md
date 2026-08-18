# 進捗シート: 累計送信数を廃止しアポ獲得数を追加

## 背景・目的

「進捗」シートの実績表示は現在、累計送信数(`累計送信数`)と今月送信数(`今月送信数(YYYY-MM)`)の2項目を書き込んでいる。
送信数は目標管理(Slack通知の必要ペース計算など)で既に使われているため、進捗シート上で重複している。
シート上では送信数よりも「アポ獲得数(商談化した企業数)」を追跡したいというユーザー要望があり、進捗シートの実績表示を差し替える。

## スコープ

- 対象は「進捗」シートへの書き込み(`writeProgressCounts`)のみ。
- Slack通知文面(`buildProgressMessage`、目標ペース計算)は変更しない。送信数ベースの目標管理はそのまま維持する。
- 「商談 確定日」列は既存の`SheetRowData.dealStatus`にマッピング済み。値は空文字("")=未成約、日付文字列(例: "2026/07/21")=成約済みという規約が`targetSelection.ts`・`companyDuplicates.ts`で使われているものと同一。

## 変更内容

### 1. `src/lib/progressGoal.ts`

- 新規関数 `countDealsWon(rows: SheetRowData[]): number` を追加する。
  - `row.dealStatus.trim() !== ""` である行数をカウントする。
- `writeProgressCounts` のシグネチャを変更する。
  - 変更前: `writeProgressCounts(client, spreadsheetId, totalSent, thisMonthSent, today)`
  - 変更後: `writeProgressCounts(client, spreadsheetId, dealsWon, thisMonthSent, today)`
  - 書き込み内容:
    - `進捗!A3` = `"アポ獲得数"`、`進捗!B3` = `dealsWon`(変更前は`"累計送信数"`/`totalSent`)
    - `進捗!A4` = `今月送信数(YYYY-MM)`、`進捗!B4` = `thisMonthSent`(変更なし)

### 2. `src/index.ts`

- `writeProgressCounts` 呼び出し箇所で、`totalSent`の代わりに`countDealsWon(countRows)`の結果を渡す。
- `totalSent`自体は`buildProgressMessage`(Slack通知)向けの計算に引き続き使用するため、計算ロジックは変更しない。

## テスト

- `tests/progressGoal.test.ts` に `countDealsWon` の単体テストを追加する。
  - 商談確定日が入っている行のみカウントする
  - 空文字・空白のみの値はカウントしない
- `writeProgressCounts`自体はSheets API呼び出しのため既存同様ユニットテスト対象外(現状も未テスト)。

## 影響範囲外

- Slack通知文面、目標ペース計算ロジック、進捗シートの目標セル(B1/B2)は変更なし。

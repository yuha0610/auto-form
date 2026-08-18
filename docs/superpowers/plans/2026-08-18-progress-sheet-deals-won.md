# 進捗シート: 累計送信数を廃止しアポ獲得数を追加 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 進捗シートの実績表示を「累計送信数」から「アポ獲得数」(商談化した企業数)に差し替える。

**Architecture:** `src/lib/progressGoal.ts` に、`SheetRowData.dealStatus`(スプレッドシートの「商談 確定日」列。空文字="未成約"、日付文字列="成約済み")が空でない行数を数える純粋関数 `countDealsWon` を追加する。`writeProgressCounts` の引数を `totalSent` から `dealsWon` に差し替え、進捗シートへの書き込みラベルを `"累計送信数"` から `"アポ獲得数"` に変更する。呼び出し元の `src/index.ts` で `countDealsWon(countRows)` を計算して渡す。

**Tech Stack:** TypeScript, Playwright Test(テストランナー), Google Sheets API(`googleapis`)

## Global Constraints

- Slack通知文面(`buildProgressMessage`)・目標ペース計算ロジックは変更しない(spec: 変更内容セクション参照)。
- 進捗シートの書き込みは `進捗!A3`="アポ獲得数" / `進捗!B3`=件数、`進捗!A4`="今月送信数(YYYY-MM)" / `進捗!B4`=件数 とする(`今月送信数`行は変更なし)。
- `dealStatus` の「成約済み」判定は `row.dealStatus.trim() !== ""` とする(既存の `targetSelection.ts`・`companyDuplicates.ts` と同一規約)。

---

### Task 1: `countDealsWon` の追加と `writeProgressCounts` の差し替え

**Files:**
- Modify: `src/lib/progressGoal.ts`(`countSentThisMonth` 関数の直後、`fetchGoal` 関数の直前に `countDealsWon` を追加。`writeProgressCounts` 関数本体を修正)
- Modify: `src/index.ts:295`(`writeProgressCounts` 呼び出し箇所)
- Test: `tests/progressGoal.test.ts`(末尾に `countDealsWon` のテストを追加)

**Interfaces:**
- Consumes: `SheetRowData`(`src/types.ts` で定義済み。`dealStatus: string` フィールドを使用)
- Produces: `countDealsWon(rows: SheetRowData[]): number` — `src/index.ts` から呼び出される

- [ ] **Step 1: 失敗するテストを書く**

`tests/progressGoal.test.ts` の末尾(ファイル末尾、237行目以降)に追記する:

```typescript
test("countDealsWon: 商談確定日が入っている行のみカウントする", () => {
  const rows = [
    makeRow({ rowIndex: 2, dealStatus: "2026/07/21" }),
    makeRow({ rowIndex: 3, dealStatus: "" }),
    makeRow({ rowIndex: 4, dealStatus: "2026/08/01" }),
  ];
  expect(countDealsWon(rows)).toBe(2);
});

test("countDealsWon: 空白のみの値はカウントしない", () => {
  const rows = [makeRow({ rowIndex: 2, dealStatus: "  " })];
  expect(countDealsWon(rows)).toBe(0);
});
```

ファイル先頭のimportに `countDealsWon` を追加する:

```typescript
import {
  parseGoal,
  countSentActions,
  countRemainingBusinessDays,
  buildProgressMessage,
  getWeekStart,
  countBusinessDaysInclusive,
  countSentThisWeek,
  countSentThisMonth,
  countDealsWon,
} from "../src/lib/progressGoal.js";
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx playwright test tests/progressGoal.test.ts -g "countDealsWon"`
Expected: FAIL(`countDealsWon` が存在せず import エラー、またはTypeScriptコンパイルエラー)

- [ ] **Step 3: `countDealsWon` を実装する**

`src/lib/progressGoal.ts` の `countSentThisMonth` 関数(129-135行目)の直後、`fetchGoal` 関数(137行目)の直前に追加:

```typescript
export function countDealsWon(rows: SheetRowData[]): number {
  return rows.filter((row) => row.dealStatus.trim() !== "").length;
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx playwright test tests/progressGoal.test.ts -g "countDealsWon"`
Expected: PASS(2件)

- [ ] **Step 5: `writeProgressCounts` を差し替える**

`src/lib/progressGoal.ts:157-177` を以下に置き換える:

```typescript
export async function writeProgressCounts(
  client: sheets_v4.Sheets,
  spreadsheetId: string,
  dealsWon: number,
  thisMonthSent: number,
  today: Date,
): Promise<void> {
  const monthLabel = `今月送信数(${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")})`;
  await client.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        { range: "進捗!A3", values: [["アポ獲得数"]] },
        { range: "進捗!B3", values: [[String(dealsWon)]] },
        { range: "進捗!A4", values: [[monthLabel]] },
        { range: "進捗!B4", values: [[String(thisMonthSent)]] },
      ],
    },
  });
}
```

- [ ] **Step 6: 呼び出し元を差し替える**

`src/index.ts:23` の import に `countDealsWon` を追加する:

```typescript
import {
  fetchGoal,
  countSentActions,
  countRemainingBusinessDays,
  countSentThisWeek,
  countBusinessDaysInclusive,
  getWeekStart,
  buildProgressMessage,
  countSentThisMonth,
  countDealsWon,
  writeProgressCounts,
} from "./lib/progressGoal.js";
```

`src/index.ts:295` の呼び出しを以下に置き換える(`totalSent` はSlack通知(`buildProgressMessage`)向けにこのあとも使われているため、削除せずそのまま残す):

```typescript
          const dealsWon = countDealsWon(countRows);
          await writeProgressCounts(sheetsClient, spreadsheetId, dealsWon, thisMonthSent, today);
```

- [ ] **Step 7: 型チェックとテスト一式を実行して確認する**

Run: `npx tsc --noEmit && npx playwright test tests/progressGoal.test.ts`
Expected: PASS(型エラーなし、全テストPASS)

- [ ] **Step 8: コミットする**

```bash
git add src/lib/progressGoal.ts src/index.ts tests/progressGoal.test.ts
git commit -m "feat: replace progress sheet send count with deals-won count"
```

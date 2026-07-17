# 週次サブ目標 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 既存の進捗通知(累計件数・残り営業日・必要ペース)に、今週(月曜〜日曜のカレンダー週)の実績と週残り目標を追記する。

**Architecture:** `src/lib/progressGoal.ts` に週の境界計算・週内実績カウントの純粋関数を追加し、`buildProgressMessage` のシグネチャに週関連の2引数を追加する。`src/index.ts` の既存呼び出し箇所で、これらの値を計算して渡す。

**Tech Stack:** TypeScript (NodeNext ESM, `.js`拡張子でのimport)、テストは `@playwright/test` の `test`/`expect`。

## Global Constraints

- 週は月曜日〜日曜日のカレンダー週。日本の祝日は考慮しない(土日のみ非営業日)
- 週次行は「通常時(未達成かつ期限内)」のメッセージにのみ追記する。達成済み・期限切れの文言には追記しない
- 累計と同様、週の実績カウントも「フォーム営業 1回目」列のみを対象とする
- 既存の`tests/progressGoal.test.ts`・`tests/slackNotify.test.ts`の全テストは変更後も引き続きPASSすること(`buildProgressMessage`の既存3テストは新しい引数を渡すよう更新する)

---

### Task 1: `getWeekStart` と `countBusinessDaysInclusive`

**Files:**
- Modify: `src/lib/progressGoal.ts`
- Test: `tests/progressGoal.test.ts`

**Interfaces:**
- Consumes: なし(純粋関数)
- Produces:
  - `getWeekStart(date: Date): Date`
  - `countBusinessDaysInclusive(from: Date, to: Date): number`
  - Task 2・Task 4がこの2関数を利用する

- [ ] **Step 1: 失敗するテストを書く**

`tests/progressGoal.test.ts` の末尾に追記する:

```ts
import { getWeekStart, countBusinessDaysInclusive } from "../src/lib/progressGoal.js";

test("getWeekStart: 週の途中の平日から月曜日を返す", () => {
  const wednesday = new Date(2026, 6, 15); // 2026/07/15 水曜
  const start = getWeekStart(wednesday);
  expect(start.getFullYear()).toBe(2026);
  expect(start.getMonth()).toBe(6);
  expect(start.getDate()).toBe(13); // 2026/07/13 月曜
});

test("getWeekStart: 日曜日からは同じ週の月曜日を返す(前週ではない)", () => {
  const sunday = new Date(2026, 6, 19); // 2026/07/19 日曜
  const start = getWeekStart(sunday);
  expect(start.getDate()).toBe(13); // 同じ週の2026/07/13 月曜
});

test("getWeekStart: 月曜日自身を渡すとその日をそのまま返す", () => {
  const monday = new Date(2026, 6, 13);
  const start = getWeekStart(monday);
  expect(start.getDate()).toBe(13);
});

test("countBusinessDaysInclusive: 両端が平日なら日数をそのままカウントする", () => {
  const from = new Date(2026, 6, 13); // 月曜
  const to = new Date(2026, 6, 17); // 金曜
  expect(countBusinessDaysInclusive(from, to)).toBe(5);
});

test("countBusinessDaysInclusive: fromとtoが同じ平日なら1を返す", () => {
  const day = new Date(2026, 6, 17); // 金曜
  expect(countBusinessDaysInclusive(day, day)).toBe(1);
});

test("countBusinessDaysInclusive: 土日を挟む場合は除外する", () => {
  const from = new Date(2026, 6, 13); // 月曜
  const to = new Date(2026, 6, 19); // 日曜
  expect(countBusinessDaysInclusive(from, to)).toBe(5); // 月〜金の5日
});

test("countBusinessDaysInclusive: fromがtoより後なら0を返す", () => {
  const from = new Date(2026, 6, 17);
  const to = new Date(2026, 6, 13);
  expect(countBusinessDaysInclusive(from, to)).toBe(0);
});
```

**Run:** `npx playwright test tests/progressGoal.test.ts`
**Expected:** FAIL(`getWeekStart`・`countBusinessDaysInclusive` が未定義)

- [ ] **Step 2: `src/lib/progressGoal.ts` に実装を追加する**

`countRemainingBusinessDays` 関数の直後に追記する:

```ts
export function getWeekStart(date: Date): Date {
  const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = midnight.getDay();
  const diffToMonday = day === 0 ? 6 : day - 1;
  midnight.setDate(midnight.getDate() - diffToMonday);
  return midnight;
}

export function countBusinessDaysInclusive(from: Date, to: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  const fromMidnight = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const toMidnight = new Date(to.getFullYear(), to.getMonth(), to.getDate());

  let count = 0;
  for (
    let d = new Date(fromMidnight.getTime());
    d.getTime() <= toMidnight.getTime();
    d = new Date(d.getTime() + msPerDay)
  ) {
    if (!isWeekend(d)) count++;
  }
  return count;
}
```

- [ ] **Step 3: テストを実行してパスすることを確認する**

**Run:** `npx playwright test tests/progressGoal.test.ts`
**Expected:** 全ケース PASS(既存分含む)

- [ ] **Step 4: コミットする**

```bash
git add src/lib/progressGoal.ts tests/progressGoal.test.ts
git commit -m "feat: add getWeekStart and countBusinessDaysInclusive"
```

---

### Task 2: `countSentThisWeek`

**Files:**
- Modify: `src/lib/progressGoal.ts`
- Test: `tests/progressGoal.test.ts`

**Interfaces:**
- Consumes: `parseSheetDate`(既存import)、`SheetRowData`
- Produces: `countSentThisWeek(rows: SheetRowData[], weekStart: Date, today: Date): number` — Task 4が利用する

- [ ] **Step 1: 失敗するテストを書く**

`tests/progressGoal.test.ts` の末尾に追記する:

```ts
import { countSentThisWeek } from "../src/lib/progressGoal.js";

test("countSentThisWeek: 週の範囲内(月曜〜今日)の送信をカウントする", () => {
  const weekStart = new Date(2026, 6, 13); // 月曜
  const today = new Date(2026, 6, 16); // 木曜
  const rows = [
    makeRow({ rowIndex: 2, firstSentAt: "2026/07/13" }), // 月曜(範囲内)
    makeRow({ rowIndex: 3, firstSentAt: "2026/07/16" }), // 今日(範囲内)
    makeRow({ rowIndex: 4, firstSentAt: "2026/07/10" }), // 先週(範囲外)
    makeRow({ rowIndex: 5, firstSentAt: null }),
  ];
  expect(countSentThisWeek(rows, weekStart, today)).toBe(2);
});

test("countSentThisWeek: 来週の日付は範囲外としてカウントしない", () => {
  const weekStart = new Date(2026, 6, 13);
  const today = new Date(2026, 6, 16);
  const rows = [makeRow({ rowIndex: 2, firstSentAt: "2026/07/20" })];
  expect(countSentThisWeek(rows, weekStart, today)).toBe(0);
});
```

**Run:** `npx playwright test tests/progressGoal.test.ts`
**Expected:** FAIL(`countSentThisWeek` が未定義)

- [ ] **Step 2: `src/lib/progressGoal.ts` に実装を追加する**

`countBusinessDaysInclusive` 関数の直後に追記する:

```ts
export function countSentThisWeek(
  rows: SheetRowData[],
  weekStart: Date,
  today: Date,
): number {
  const weekStartMidnight = new Date(
    weekStart.getFullYear(),
    weekStart.getMonth(),
    weekStart.getDate(),
  );
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  return rows.filter((row) => {
    const sentAt = parseSheetDate(row.firstSentAt);
    if (!sentAt) return false;
    return sentAt.getTime() >= weekStartMidnight.getTime() && sentAt.getTime() <= todayMidnight.getTime();
  }).length;
}
```

- [ ] **Step 3: テストを実行してパスすることを確認する**

**Run:** `npx playwright test tests/progressGoal.test.ts`
**Expected:** 全ケース PASS(既存分含む)

- [ ] **Step 4: コミットする**

```bash
git add src/lib/progressGoal.ts tests/progressGoal.test.ts
git commit -m "feat: add countSentThisWeek"
```

---

### Task 3: `buildProgressMessage` に週次行を追加

**Files:**
- Modify: `src/lib/progressGoal.ts`
- Test: `tests/progressGoal.test.ts`

**Interfaces:**
- Consumes: `formatSheetDate`(既存import)
- Produces: `buildProgressMessage(totalSent, goal, remainingBusinessDays, thisWeekSent, thisWeekRemainingBusinessDays, weekStart): string`(シグネチャ変更) — Task 4が利用する

`buildProgressMessage`は月曜日の日付をラベルに使うため`weekStart: Date`も受け取る。

- [ ] **Step 1: 既存3テストを新シグネチャに更新し、新規テストを追加する**

`tests/progressGoal.test.ts` の既存3つの`buildProgressMessage`テストを以下に置き換える:

```ts
test("buildProgressMessage: 通常時は残り件数・必要ペース・今週の状況を含む", () => {
  const goal = { targetCount: 1000, deadline: new Date(2026, 6, 31) };
  const weekStart = new Date(2026, 6, 13); // 07/13週
  const message = buildProgressMessage(156, goal, 9, 12, 1, weekStart);
  expect(message).toBe(
    "累計(1回目): 156件 / 目標1000件(残り844件)\n残り営業日: 9日\n必要ペース: 94件/日\n今週(07/13週): 12件 / 週残り目標94件",
  );
});

test("buildProgressMessage: 目標達成済みの場合は達成メッセージのみ返す(週次行なし)", () => {
  const goal = { targetCount: 1000, deadline: new Date(2026, 6, 31) };
  const weekStart = new Date(2026, 6, 13);
  const message = buildProgressMessage(1020, goal, 9, 12, 1, weekStart);
  expect(message).toBe("累計(1回目): 1020件 / 目標1000件 達成済み🎉");
});

test("buildProgressMessage: 残り営業日0かつ未達成の場合は期限切れメッセージのみ返す(週次行なし)", () => {
  const goal = { targetCount: 1000, deadline: new Date(2026, 6, 31) };
  const weekStart = new Date(2026, 6, 13);
  const message = buildProgressMessage(800, goal, 0, 12, 0, weekStart);
  expect(message).toBe(
    "累計(1回目): 800件 / 目標1000件(残り200件)\n期限(2026/07/31)を過ぎています",
  );
});
```

(`makeRow`の下、既存の`buildProgressMessage`テスト3件をこの3件で置き換える。テスト名が変わるため、置き換えであって追記ではないことに注意)

**Run:** `npx playwright test tests/progressGoal.test.ts`
**Expected:** FAIL(引数の数が合わずコンパイルエラー、または既存の期待値と一致しない)

- [ ] **Step 2: `buildProgressMessage` を以下に置き換える**

```ts
export function buildProgressMessage(
  totalSent: number,
  goal: Goal,
  remainingBusinessDays: number,
  thisWeekSent: number,
  thisWeekRemainingBusinessDays: number,
  weekStart: Date,
): string {
  if (totalSent >= goal.targetCount) {
    return `累計(1回目): ${totalSent}件 / 目標${goal.targetCount}件 達成済み🎉`;
  }

  const remainingCount = goal.targetCount - totalSent;
  const base = `累計(1回目): ${totalSent}件 / 目標${goal.targetCount}件(残り${remainingCount}件)`;

  if (remainingBusinessDays === 0) {
    return `${base}\n期限(${formatSheetDate(goal.deadline)})を過ぎています`;
  }

  const requiredPace = Math.ceil(remainingCount / remainingBusinessDays);
  const weekRemainingTarget = requiredPace * thisWeekRemainingBusinessDays;
  const weekLabel = formatSheetDate(weekStart).slice(5); // "MM/DD"
  return (
    `${base}\n残り営業日: ${remainingBusinessDays}日\n必要ペース: ${requiredPace}件/日\n` +
    `今週(${weekLabel}週): ${thisWeekSent}件 / 週残り目標${weekRemainingTarget}件`
  );
}
```

- [ ] **Step 3: テストを実行してパスすることを確認する**

**Run:** `npx playwright test tests/progressGoal.test.ts`
**Expected:** 全ケース PASS

- [ ] **Step 4: コミットする**

```bash
git add src/lib/progressGoal.ts tests/progressGoal.test.ts
git commit -m "feat: add weekly sub-goal line to buildProgressMessage"
```

---

### Task 4: `index.ts` への組み込み

**Files:**
- Modify: `src/index.ts:12-18`(import文), `src/index.ts:241-246`(通知処理)

**Interfaces:**
- Consumes: `getWeekStart`・`countBusinessDaysInclusive`・`countSentThisWeek`(Task 1〜2)、変更後の`buildProgressMessage`(Task 3)

- [ ] **Step 1: importを更新する**

`src/index.ts:13-18` の既存ブロック:

```ts
import {
  fetchGoal,
  countFirstSent,
  countRemainingBusinessDays,
  buildProgressMessage,
} from "./lib/progressGoal.js";
```

を以下に置き換える:

```ts
import {
  fetchGoal,
  countFirstSent,
  countRemainingBusinessDays,
  countSentThisWeek,
  countBusinessDaysInclusive,
  getWeekStart,
  buildProgressMessage,
} from "./lib/progressGoal.js";
```

- [ ] **Step 2: 通知処理を更新する**

`src/index.ts:241-246` の既存ブロック:

```ts
        const goal = await fetchGoal(sheetsClient, spreadsheetId);
        if (goal) {
          const totalSent = countFirstSent(countRows);
          const remainingBusinessDays = countRemainingBusinessDays(new Date(), goal.deadline);
          await notifySlackText(buildProgressMessage(totalSent, goal, remainingBusinessDays));
        }
```

を以下に置き換える:

```ts
        const goal = await fetchGoal(sheetsClient, spreadsheetId);
        if (goal) {
          const today = new Date();
          const totalSent = countFirstSent(countRows);
          const remainingBusinessDays = countRemainingBusinessDays(today, goal.deadline);

          const weekStart = getWeekStart(today);
          const weekEnd = new Date(weekStart);
          weekEnd.setDate(weekEnd.getDate() + 6);
          const thisWeekSent = countSentThisWeek(countRows, weekStart, today);
          const thisWeekRemainingBusinessDays = countBusinessDaysInclusive(today, weekEnd);

          await notifySlackText(
            buildProgressMessage(
              totalSent,
              goal,
              remainingBusinessDays,
              thisWeekSent,
              thisWeekRemainingBusinessDays,
              weekStart,
            ),
          );
        }
```

- [ ] **Step 3: 型チェックを通すことを確認する**

**Run:** `npm run build`
**Expected:** エラーなく完了する

- [ ] **Step 4: 全テストがパスすることを確認する**

**Run:** `npm test`
**Expected:** 全テストPASS

- [ ] **Step 5: コミットする**

```bash
git add src/index.ts
git commit -m "feat: notify this week's actual and remaining sub-goal alongside overall progress"
```

---

### Task 5: 手動動作確認

**Files:** なし(コード変更なし)

このタスクはコード変更を含まないため、コミットは発生しない。

- [ ] **Step 1: 実データに対して週次計算が期待通りか確認する**

以下の一時スクリプトを作成して実行し、実際の「進捗」シートと今日の日付に対する出力を目視確認する。確認後、このファイルは削除する。

```bash
cat > verify_weekly.tmp.mjs << 'SCRIPT'
import "dotenv/config";
import { createSheetsClient, getFirstSheetName, fetchSheetData } from "./dist/lib/sheetsClient.js";
import { parseSheetRows } from "./dist/lib/sheetData.js";
import {
  fetchGoal,
  countFirstSent,
  countRemainingBusinessDays,
  countSentThisWeek,
  countBusinessDaysInclusive,
  getWeekStart,
  buildProgressMessage,
} from "./dist/lib/progressGoal.js";

const spreadsheetId = process.env.GOOGLE_SHEET_ID;
const client = await createSheetsClient();
const goal = await fetchGoal(client, spreadsheetId);
const sheetName = await getFirstSheetName(client, spreadsheetId);
const raw = await fetchSheetData(client, spreadsheetId, sheetName);
const rows = parseSheetRows(raw);

const today = new Date();
const totalSent = countFirstSent(rows);
const remainingBusinessDays = countRemainingBusinessDays(today, goal.deadline);
const weekStart = getWeekStart(today);
const weekEnd = new Date(weekStart);
weekEnd.setDate(weekEnd.getDate() + 6);
const thisWeekSent = countSentThisWeek(rows, weekStart, today);
const thisWeekRemainingBusinessDays = countBusinessDaysInclusive(today, weekEnd);

console.log(
  buildProgressMessage(
    totalSent,
    goal,
    remainingBusinessDays,
    thisWeekSent,
    thisWeekRemainingBusinessDays,
    weekStart,
  ),
);
SCRIPT
npm run build
node verify_weekly.tmp.mjs
rm verify_weekly.tmp.mjs
```

**Expected:** メッセージに「今週(MM/DD週): N件 / 週残り目標N件」の行が含まれ、月曜日の日付・件数が実際のスプレッドシートの内容と整合していること

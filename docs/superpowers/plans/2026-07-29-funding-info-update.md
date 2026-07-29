# 資金調達情報の最新化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** スプレッドシート全1454行の「資金調達額」「企業ラウンド」「資金調達月」「PRTimes URL」を最新化するための、調査結果(JSON)取り込み・差分分類・反映(dry-run/--apply)の一式を実装する。

**Architecture:** 資金調達関連4列を`SheetRowData`に追加し、Web検索による調査結果JSON(`data/funding-research-results.json`、別途Workflowツールで生成)と現在のシート値を突き合わせて「更新候補/要目視確認/変更なし」に分類する純粋関数群(`src/lib/fundingUpdate.ts`)を作り、それを呼び出す`scripts/updateFundingInfo.ts`(dry-run既定、`--apply`で書き込み)を`cleanupCompanyData.ts`と同じ構成で実装する。

**Tech Stack:** TypeScript(Node.js, ESM, `.js`拡張子importのNodeNext構成), `@playwright/test`(ユニットテストランナー), `googleapis`(Sheets API)

## Global Constraints

- import文は既存コードと同じくESM形式で拡張子`.js`を付ける(例: `from "../types.js"`)
- 列名は`src/types.ts`の`COLUMNS`に定義し、直書きしない
- テストは `npx playwright test <path>` で実行する
- 反映スクリプトは`cleanupCompanyData.ts`と同じ「既定はドライラン、`--apply`明示時のみ書き込み」の構成に揃える
- Sheets書き込みは既存の`writeCells`(`valueInputOption: "USER_ENTERED"`)をそのまま使う。新しいSheets APIラッパーは作らない
- 参照設計: `docs/superpowers/specs/2026-07-29-funding-info-update-design.md`

---

### Task 1: 資金調達関連4列を`SheetRowData`に追加する

**Files:**
- Modify: `src/types.ts`
- Modify: `src/lib/sheetData.ts:36-61`
- Modify: `tests/sheetData.test.ts`

**Interfaces:**
- Produces:
  - `COLUMNS.fundingAmount: string`(値は`"資金調達額"`)
  - `COLUMNS.fundingRound: string`(値は`"企業ラウンド"`)
  - `COLUMNS.fundingMonth: string`(値は`"資金調達月"`)
  - `COLUMNS.prTimesUrl: string`(値は`"PRTimes URL"`)
  - `SheetRowData.fundingAmount: string`
  - `SheetRowData.fundingRound: string`
  - `SheetRowData.fundingMonth: string`
  - `SheetRowData.prTimesUrl: string`

- [ ] **Step 1: 失敗するテストを書く(`tests/sheetData.test.ts`に追記)**

```ts
test("parseSheetRows: 資金調達関連4列の値を読み込む", () => {
  const headerRow = [
    COLUMNS.companyName,
    COLUMNS.companyUrl,
    COLUMNS.formUrl,
    COLUMNS.note,
    COLUMNS.dealStatus,
    COLUMNS.firstSent,
    COLUMNS.secondSent,
    COLUMNS.thirdSent,
    COLUMNS.email,
    COLUMNS.fundingAmount,
    COLUMNS.fundingRound,
    COLUMNS.fundingMonth,
    COLUMNS.prTimesUrl,
  ];
  const dataRows = [
    [
      "サンプル株式会社",
      "https://example.com/",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "3億円",
      "シリーズB",
      "2026-05",
      "https://prtimes.jp/example",
    ],
  ];
  const rows = parseSheetRows({ headerRow, dataRows });
  expect(rows[0].fundingAmount).toBe("3億円");
  expect(rows[0].fundingRound).toBe("シリーズB");
  expect(rows[0].fundingMonth).toBe("2026-05");
  expect(rows[0].prTimesUrl).toBe("https://prtimes.jp/example");
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx playwright test tests/sheetData.test.ts -g "資金調達関連4列"`
Expected: FAIL(`COLUMNS.fundingAmount`が`undefined`、または`rows[0].fundingAmount`が`undefined`でassertion失敗)

- [ ] **Step 3: `src/types.ts`を変更する(該当部分を以下に置き換え)**

```ts
export const COLUMNS = {
  companyName: "企業名",
  companyUrl: "企業URL",
  formUrl: "フォームURL",
  note: "備考",
  dealStatus: "商談 確定日",
  firstSent: "フォーム営業 1回目",
  secondSent: "フォーム営業 2回目",
  thirdSent: "フォーム営業 3回目",
  email: "メールアドレス",
  fundingAmount: "資金調達額",
  fundingRound: "企業ラウンド",
  fundingMonth: "資金調達月",
  prTimesUrl: "PRTimes URL",
} as const;

export interface SheetRowData {
  rowIndex: number;
  companyName: string;
  companyUrl: string;
  formUrl: string;
  note: string;
  dealStatus: string;
  firstSentAt: string | null;
  secondSentAt: string | null;
  thirdSentAt: string | null;
  email: string;
  fundingAmount: string;
  fundingRound: string;
  fundingMonth: string;
  prTimesUrl: string;
}
```

- [ ] **Step 4: `src/lib/sheetData.ts`の`parseSheetRows`を変更する(該当部分を以下に置き換え)**

```ts
export function parseSheetRows(raw: RawSheetData): SheetRowData[] {
  const col = {
    companyName: findColumnIndex(raw.headerRow, COLUMNS.companyName),
    companyUrl: findColumnIndex(raw.headerRow, COLUMNS.companyUrl),
    formUrl: findColumnIndex(raw.headerRow, COLUMNS.formUrl),
    note: findColumnIndex(raw.headerRow, COLUMNS.note),
    dealStatus: findColumnIndex(raw.headerRow, COLUMNS.dealStatus),
    firstSent: findColumnIndex(raw.headerRow, COLUMNS.firstSent),
    secondSent: findColumnIndex(raw.headerRow, COLUMNS.secondSent),
    thirdSent: findColumnIndex(raw.headerRow, COLUMNS.thirdSent),
    email: findColumnIndex(raw.headerRow, COLUMNS.email),
    fundingAmount: findColumnIndex(raw.headerRow, COLUMNS.fundingAmount),
    fundingRound: findColumnIndex(raw.headerRow, COLUMNS.fundingRound),
    fundingMonth: findColumnIndex(raw.headerRow, COLUMNS.fundingMonth),
    prTimesUrl: findColumnIndex(raw.headerRow, COLUMNS.prTimesUrl),
  };

  return raw.dataRows.map((cells, i) => ({
    rowIndex: i + 2,
    companyName: cells[col.companyName] ?? "",
    companyUrl: cells[col.companyUrl] ?? "",
    formUrl: cells[col.formUrl] ?? "",
    note: cells[col.note] ?? "",
    dealStatus: cells[col.dealStatus] ?? "",
    firstSentAt: cells[col.firstSent] || null,
    secondSentAt: cells[col.secondSent] || null,
    thirdSentAt: cells[col.thirdSent] || null,
    email: cells[col.email] ?? "",
    fundingAmount: cells[col.fundingAmount] ?? "",
    fundingRound: cells[col.fundingRound] ?? "",
    fundingMonth: cells[col.fundingMonth] ?? "",
    prTimesUrl: cells[col.prTimesUrl] ?? "",
  }));
}
```

- [ ] **Step 5: 既存の`parseSheetRows`関連テストを新4列に対応させる**

`tests/sheetData.test.ts`内の既存3テストは、`headerRow`/`dataRows`に新4列分の値が無いため`findColumnIndex`がエラーを投げて失敗するようになる。以下の3テストをそれぞれ丸ごと置き換える。

`"parseSheetRows: ヘッダー名から列を引いてSheetRowDataに変換する"`を置き換え:

```ts
test("parseSheetRows: ヘッダー名から列を引いてSheetRowDataに変換する", () => {
  const headerRow = [
    COLUMNS.companyName,
    COLUMNS.companyUrl,
    COLUMNS.formUrl,
    COLUMNS.note,
    COLUMNS.dealStatus,
    COLUMNS.firstSent,
    COLUMNS.secondSent,
    COLUMNS.thirdSent,
    COLUMNS.email,
    COLUMNS.fundingAmount,
    COLUMNS.fundingRound,
    COLUMNS.fundingMonth,
    COLUMNS.prTimesUrl,
  ];
  const dataRows = [
    ["サンプル株式会社", "https://example.com/", "", "フォーム無", "無", "", "", "", "", "", "", "", ""],
  ];
  const rows = parseSheetRows({ headerRow, dataRows });
  expect(rows).toEqual([
    {
      rowIndex: 2,
      companyName: "サンプル株式会社",
      companyUrl: "https://example.com/",
      formUrl: "",
      note: "フォーム無",
      dealStatus: "無",
      firstSentAt: null,
      secondSentAt: null,
      thirdSentAt: null,
      email: "",
      fundingAmount: "",
      fundingRound: "",
      fundingMonth: "",
      prTimesUrl: "",
    },
  ]);
});
```

`"parseSheetRows: 実シートのように改行入りヘッダーでも正しくパースできる"`を置き換え:

```ts
test("parseSheetRows: 実シートのように改行入りヘッダーでも正しくパースできる", () => {
  const headerRow = [
    COLUMNS.companyName,
    COLUMNS.companyUrl,
    COLUMNS.formUrl,
    COLUMNS.note,
    "商談\n確定日",
    "フォーム営業\n1回目",
    COLUMNS.secondSent,
    COLUMNS.thirdSent,
    COLUMNS.email,
    COLUMNS.fundingAmount,
    COLUMNS.fundingRound,
    COLUMNS.fundingMonth,
    COLUMNS.prTimesUrl,
  ];
  const dataRows = [
    ["サンプル株式会社", "https://example.com/", "", "フォーム無", "無", "2026-07-01", "", "", "", "", "", "", ""],
  ];
  const rows = parseSheetRows({ headerRow, dataRows });
  expect(rows).toEqual([
    {
      rowIndex: 2,
      companyName: "サンプル株式会社",
      companyUrl: "https://example.com/",
      formUrl: "",
      note: "フォーム無",
      dealStatus: "無",
      firstSentAt: "2026-07-01",
      secondSentAt: null,
      thirdSentAt: null,
      email: "",
      fundingAmount: "",
      fundingRound: "",
      fundingMonth: "",
      prTimesUrl: "",
    },
  ]);
});
```

`"parseSheetRows: メールアドレス列の値を読み込む"`を置き換え:

```ts
test("parseSheetRows: メールアドレス列の値を読み込む", () => {
  const headerRow = [
    COLUMNS.companyName,
    COLUMNS.companyUrl,
    COLUMNS.formUrl,
    COLUMNS.note,
    COLUMNS.dealStatus,
    COLUMNS.firstSent,
    COLUMNS.secondSent,
    COLUMNS.thirdSent,
    COLUMNS.email,
    COLUMNS.fundingAmount,
    COLUMNS.fundingRound,
    COLUMNS.fundingMonth,
    COLUMNS.prTimesUrl,
  ];
  const dataRows = [
    ["サンプル株式会社", "https://example.com/", "", "", "", "", "", "", "info@example.com", "", "", "", ""],
  ];
  const rows = parseSheetRows({ headerRow, dataRows });
  expect(rows[0].email).toBe("info@example.com");
});
```

- [ ] **Step 6: テストを実行してすべて通ることを確認する**

Run: `npx playwright test tests/sheetData.test.ts`
Expected: PASS(全件)

- [ ] **Step 7: コミット**

```bash
git add src/types.ts src/lib/sheetData.ts tests/sheetData.test.ts
git commit -m "feat: add funding info columns to SheetRowData"
```

---

### Task 2: 調査結果の分類ロジック`classifyFundingResults`を実装する

**Files:**
- Create: `src/lib/fundingUpdate.ts`
- Create: `tests/fundingUpdate.test.ts`

**Interfaces:**
- Consumes: `SheetRowData`(`src/types.ts`、Task 1で`fundingAmount`/`fundingRound`/`fundingMonth`/`prTimesUrl`追加済み)
- Produces:
  - `FundingResearchResult`(型)
  - `FundingUpdateCandidate`(型)
  - `FundingReviewItem`(型)
  - `FundingClassification`(型)
  - `classifyFundingResults(results: FundingResearchResult[], rows: SheetRowData[]): FundingClassification`

- [ ] **Step 1: 失敗するテストを書く(`tests/fundingUpdate.test.ts`を新規作成)**

```ts
import { test, expect } from "@playwright/test";
import { classifyFundingResults, type FundingResearchResult } from "../src/lib/fundingUpdate.js";
import type { SheetRowData } from "../src/types.js";

function makeRow(overrides: Partial<SheetRowData> = {}): SheetRowData {
  return {
    rowIndex: 2,
    companyName: "サンプル株式会社",
    companyUrl: "https://example.com/",
    formUrl: "",
    note: "",
    dealStatus: "",
    firstSentAt: null,
    secondSentAt: null,
    thirdSentAt: null,
    email: "",
    fundingAmount: "1億円",
    fundingRound: "シードラウンド",
    fundingMonth: "2025-01",
    prTimesUrl: "https://prtimes.jp/old",
    ...overrides,
  };
}

test("classifyFundingResults: high確信度かつupdateCandidateは更新候補に分類される", () => {
  const rows = [makeRow()];
  const results: FundingResearchResult[] = [
    {
      rowIndex: 2,
      companyName: "サンプル株式会社",
      found: true,
      updateCandidate: true,
      fundingAmount: "5億円",
      fundingRound: "シリーズB",
      fundingMonth: "2026-06",
      sourceUrl: "https://prtimes.jp/new",
      confidence: "high",
      reason: "PR TIMESとNewsPicksの2ソースで一致",
    },
  ];

  const { updateCandidates, needsReview, unchangedCount } = classifyFundingResults(results, rows);

  expect(updateCandidates).toEqual([
    {
      rowIndex: 2,
      companyName: "サンプル株式会社",
      before: { fundingAmount: "1億円", fundingRound: "シードラウンド", fundingMonth: "2025-01", prTimesUrl: "https://prtimes.jp/old" },
      after: { fundingAmount: "5億円", fundingRound: "シリーズB", fundingMonth: "2026-06", prTimesUrl: "https://prtimes.jp/new" },
    },
  ]);
  expect(needsReview).toEqual([]);
  expect(unchangedCount).toBe(0);
});

test("classifyFundingResults: confidenceがlowなら要目視確認に回す", () => {
  const rows = [makeRow()];
  const results: FundingResearchResult[] = [
    {
      rowIndex: 2,
      companyName: "サンプル株式会社",
      found: true,
      updateCandidate: false,
      confidence: "low",
      reason: "ソースが1件のみで確信が持てない",
    },
  ];

  const { updateCandidates, needsReview, unchangedCount } = classifyFundingResults(results, rows);

  expect(updateCandidates).toEqual([]);
  expect(needsReview).toEqual([
    { rowIndex: 2, companyName: "サンプル株式会社", reason: "ソースが1件のみで確信が持てない" },
  ]);
  expect(unchangedCount).toBe(0);
});

test("classifyFundingResults: updateCandidateがfalseかつhigh確信度は変更なしカウントに入る", () => {
  const rows = [makeRow()];
  const results: FundingResearchResult[] = [
    {
      rowIndex: 2,
      companyName: "サンプル株式会社",
      found: true,
      updateCandidate: false,
      confidence: "high",
      reason: "既存値と同じ最新ラウンドを確認",
    },
  ];

  const { updateCandidates, needsReview, unchangedCount } = classifyFundingResults(results, rows);

  expect(updateCandidates).toEqual([]);
  expect(needsReview).toEqual([]);
  expect(unchangedCount).toBe(1);
});

test("classifyFundingResults: シート上に該当行が無い結果は要目視確認に回す", () => {
  const rows = [makeRow({ rowIndex: 2 })];
  const results: FundingResearchResult[] = [
    {
      rowIndex: 999,
      companyName: "消えた株式会社",
      found: true,
      updateCandidate: true,
      confidence: "high",
      reason: "調べたが該当行なし",
    },
  ];

  const { needsReview } = classifyFundingResults(results, rows);

  expect(needsReview).toEqual([
    { rowIndex: 999, companyName: "消えた株式会社", reason: "シート上に該当行が見つかりません" },
  ]);
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx playwright test tests/fundingUpdate.test.ts`
Expected: FAIL(`../src/lib/fundingUpdate.js`が存在せずモジュール解決エラー)

- [ ] **Step 3: `src/lib/fundingUpdate.ts`を新規作成する**

```ts
import type { SheetRowData } from "../types.js";

export interface FundingResearchResult {
  rowIndex: number;
  companyName: string;
  found: boolean;
  updateCandidate: boolean;
  fundingAmount?: string;
  fundingRound?: string;
  fundingMonth?: string;
  sourceUrl?: string;
  confidence: "high" | "low";
  reason: string;
}

export interface FundingFields {
  fundingAmount: string;
  fundingRound: string;
  fundingMonth: string;
  prTimesUrl: string;
}

export interface FundingUpdateCandidate {
  rowIndex: number;
  companyName: string;
  before: FundingFields;
  after: FundingFields;
}

export interface FundingReviewItem {
  rowIndex: number;
  companyName: string;
  reason: string;
}

export interface FundingClassification {
  updateCandidates: FundingUpdateCandidate[];
  needsReview: FundingReviewItem[];
  unchangedCount: number;
}

/** JSON調査結果と現在のシート行を突き合わせ、更新候補/要目視確認/変更なしに分類する。 */
export function classifyFundingResults(
  results: FundingResearchResult[],
  rows: SheetRowData[],
): FundingClassification {
  const rowByIndex = new Map(rows.map((row) => [row.rowIndex, row]));
  const updateCandidates: FundingUpdateCandidate[] = [];
  const needsReview: FundingReviewItem[] = [];
  let unchangedCount = 0;

  for (const result of results) {
    const row = rowByIndex.get(result.rowIndex);
    if (!row) {
      needsReview.push({
        rowIndex: result.rowIndex,
        companyName: result.companyName,
        reason: "シート上に該当行が見つかりません",
      });
      continue;
    }

    if (result.confidence === "low") {
      needsReview.push({ rowIndex: result.rowIndex, companyName: result.companyName, reason: result.reason });
      continue;
    }

    if (!result.updateCandidate) {
      unchangedCount++;
      continue;
    }

    updateCandidates.push({
      rowIndex: result.rowIndex,
      companyName: result.companyName,
      before: {
        fundingAmount: row.fundingAmount,
        fundingRound: row.fundingRound,
        fundingMonth: row.fundingMonth,
        prTimesUrl: row.prTimesUrl,
      },
      after: {
        fundingAmount: result.fundingAmount ?? row.fundingAmount,
        fundingRound: result.fundingRound ?? row.fundingRound,
        fundingMonth: result.fundingMonth ?? row.fundingMonth,
        prTimesUrl: result.sourceUrl ?? row.prTimesUrl,
      },
    });
  }

  return { updateCandidates, needsReview, unchangedCount };
}
```

- [ ] **Step 4: テストを実行してすべて通ることを確認する**

Run: `npx playwright test tests/fundingUpdate.test.ts`
Expected: PASS(4件全て)

- [ ] **Step 5: コミット**

```bash
git add src/lib/fundingUpdate.ts tests/fundingUpdate.test.ts
git commit -m "feat: classify funding research results against current sheet values"
```

---

### Task 3: 書き込みプラン`buildFundingWrites`を実装する(手動編集済み行のスキップ判定)

**Files:**
- Modify: `src/lib/fundingUpdate.ts`
- Modify: `tests/fundingUpdate.test.ts`

**Interfaces:**
- Consumes: `FundingUpdateCandidate`, `SheetRowData`(Task 2で定義済み)
- Produces:
  - `StaleSkip`(型)
  - `FundingWritePlan`(型)
  - `buildFundingWrites(candidates: FundingUpdateCandidate[], currentRows: SheetRowData[], columnNames: { fundingAmount: string; fundingRound: string; fundingMonth: string; prTimesUrl: string }): FundingWritePlan`

- [ ] **Step 1: 失敗するテストを`tests/fundingUpdate.test.ts`に追記する**

```ts
import { buildFundingWrites } from "../src/lib/fundingUpdate.js";
import { COLUMNS } from "../src/types.js";

const FUNDING_COLUMN_NAMES = {
  fundingAmount: COLUMNS.fundingAmount,
  fundingRound: COLUMNS.fundingRound,
  fundingMonth: COLUMNS.fundingMonth,
  prTimesUrl: COLUMNS.prTimesUrl,
};

test("buildFundingWrites: 現在値がbeforeと一致すれば4列分の書き込みを生成する", () => {
  const candidates = [
    {
      rowIndex: 2,
      companyName: "サンプル株式会社",
      before: { fundingAmount: "1億円", fundingRound: "シードラウンド", fundingMonth: "2025-01", prTimesUrl: "https://prtimes.jp/old" },
      after: { fundingAmount: "5億円", fundingRound: "シリーズB", fundingMonth: "2026-06", prTimesUrl: "https://prtimes.jp/new" },
    },
  ];
  const currentRows = [makeRow({ rowIndex: 2 })];

  const { writes, staleSkips } = buildFundingWrites(candidates, currentRows, FUNDING_COLUMN_NAMES);

  expect(staleSkips).toEqual([]);
  expect(writes).toEqual([
    { rowIndex: 2, columnName: COLUMNS.fundingAmount, value: "5億円" },
    { rowIndex: 2, columnName: COLUMNS.fundingRound, value: "シリーズB" },
    { rowIndex: 2, columnName: COLUMNS.fundingMonth, value: "2026-06" },
    { rowIndex: 2, columnName: COLUMNS.prTimesUrl, value: "https://prtimes.jp/new" },
  ]);
});

test("buildFundingWrites: 現在値がbeforeと異なる(手動編集済み)行はスキップされる", () => {
  const candidates = [
    {
      rowIndex: 2,
      companyName: "サンプル株式会社",
      before: { fundingAmount: "1億円", fundingRound: "シードラウンド", fundingMonth: "2025-01", prTimesUrl: "https://prtimes.jp/old" },
      after: { fundingAmount: "5億円", fundingRound: "シリーズB", fundingMonth: "2026-06", prTimesUrl: "https://prtimes.jp/new" },
    },
  ];
  const currentRows = [makeRow({ rowIndex: 2, fundingAmount: "2億円" })];

  const { writes, staleSkips } = buildFundingWrites(candidates, currentRows, FUNDING_COLUMN_NAMES);

  expect(writes).toEqual([]);
  expect(staleSkips).toEqual([{ rowIndex: 2, companyName: "サンプル株式会社" }]);
});
```

(`makeRow`はTask 2で同ファイルに定義済みのヘルパーをそのまま再利用する)

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx playwright test tests/fundingUpdate.test.ts -g "buildFundingWrites"`
Expected: FAIL(`buildFundingWrites`が存在せずimportエラー)

- [ ] **Step 3: `src/lib/fundingUpdate.ts`に追記する**

```ts
export interface StaleSkip {
  rowIndex: number;
  companyName: string;
}

export interface FundingWritePlan {
  writes: { rowIndex: number; columnName: string; value: string }[];
  staleSkips: StaleSkip[];
}

/**
 * 書き込み直前の現在シート値と、調査結果生成時点の`before`を比較し、
 * 一致するものだけ書き込み対象にする(手動編集済みの行は誤上書きを避けるためスキップする)。
 */
export function buildFundingWrites(
  candidates: FundingUpdateCandidate[],
  currentRows: SheetRowData[],
  columnNames: FundingFields,
): FundingWritePlan {
  const currentByIndex = new Map(currentRows.map((row) => [row.rowIndex, row]));
  const writes: FundingWritePlan["writes"] = [];
  const staleSkips: StaleSkip[] = [];

  for (const candidate of candidates) {
    const current = currentByIndex.get(candidate.rowIndex);
    const stillMatches =
      current !== undefined &&
      current.fundingAmount === candidate.before.fundingAmount &&
      current.fundingRound === candidate.before.fundingRound &&
      current.fundingMonth === candidate.before.fundingMonth &&
      current.prTimesUrl === candidate.before.prTimesUrl;

    if (!stillMatches) {
      staleSkips.push({ rowIndex: candidate.rowIndex, companyName: candidate.companyName });
      continue;
    }

    writes.push({ rowIndex: candidate.rowIndex, columnName: columnNames.fundingAmount, value: candidate.after.fundingAmount });
    writes.push({ rowIndex: candidate.rowIndex, columnName: columnNames.fundingRound, value: candidate.after.fundingRound });
    writes.push({ rowIndex: candidate.rowIndex, columnName: columnNames.fundingMonth, value: candidate.after.fundingMonth });
    writes.push({ rowIndex: candidate.rowIndex, columnName: columnNames.prTimesUrl, value: candidate.after.prTimesUrl });
  }

  return { writes, staleSkips };
}
```

- [ ] **Step 4: テストを実行してすべて通ることを確認する**

Run: `npx playwright test tests/fundingUpdate.test.ts`
Expected: PASS(6件全て)

- [ ] **Step 5: コミット**

```bash
git add src/lib/fundingUpdate.ts tests/fundingUpdate.test.ts
git commit -m "feat: skip funding writes when sheet value changed since research"
```

---

### Task 4: 反映スクリプト`scripts/updateFundingInfo.ts`を実装する

**Files:**
- Create: `scripts/updateFundingInfo.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes:
  - `createSheetsClient`, `fetchSheetData`, `getFirstSheetName`, `writeCells`(`src/lib/sheetsClient.js`)
  - `parseSheetRows`(`src/lib/sheetData.js`)
  - `classifyFundingResults`, `buildFundingWrites`, `type FundingResearchResult`(`src/lib/fundingUpdate.js`、Task 2・3で実装済み)
  - `COLUMNS`(`src/types.js`)
- Produces: `npm run update:funding-info` / `npm run update:funding-info -- --apply` として実行可能なCLI

- [ ] **Step 1: `scripts/updateFundingInfo.ts`を新規作成する**

```ts
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { createSheetsClient, fetchSheetData, getFirstSheetName, writeCells } from "../src/lib/sheetsClient.js";
import { parseSheetRows } from "../src/lib/sheetData.js";
import { classifyFundingResults, buildFundingWrites, type FundingResearchResult } from "../src/lib/fundingUpdate.js";
import { COLUMNS } from "../src/types.js";

const RESULTS_PATH = "data/funding-research-results.json";

const FUNDING_COLUMN_NAMES = {
  fundingAmount: COLUMNS.fundingAmount,
  fundingRound: COLUMNS.fundingRound,
  fundingMonth: COLUMNS.fundingMonth,
  prTimesUrl: COLUMNS.prTimesUrl,
};

async function loadResults(): Promise<FundingResearchResult[]> {
  try {
    const content = await readFile(RESULTS_PATH, "utf-8");
    return JSON.parse(content) as FundingResearchResult[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      throw new Error(
        `${RESULTS_PATH} が見つかりません。先にWorkflowで調査を実行し、結果をこのパスに保存してください`,
      );
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) {
    throw new Error("環境変数 GOOGLE_SHEET_ID が設定されていません");
  }

  const results = await loadResults();
  const client = await createSheetsClient();
  const sheetName = await getFirstSheetName(client, spreadsheetId);
  const raw = await fetchSheetData(client, spreadsheetId, sheetName);
  const rows = parseSheetRows(raw);

  const { updateCandidates, needsReview, unchangedCount } = classifyFundingResults(results, rows);

  console.log(`=== 更新候補: ${updateCandidates.length}件 ===`);
  for (const candidate of updateCandidates) {
    console.log(`  [行${candidate.rowIndex}] ${candidate.companyName}`);
    console.log(`    資金調達額: "${candidate.before.fundingAmount}" -> "${candidate.after.fundingAmount}"`);
    console.log(`    企業ラウンド: "${candidate.before.fundingRound}" -> "${candidate.after.fundingRound}"`);
    console.log(`    資金調達月: "${candidate.before.fundingMonth}" -> "${candidate.after.fundingMonth}"`);
    console.log(`    PRTimes URL: "${candidate.before.prTimesUrl}" -> "${candidate.after.prTimesUrl}"`);
  }

  console.log(`\n=== 要目視確認: ${needsReview.length}件 ===`);
  for (const item of needsReview) {
    console.log(`  [行${item.rowIndex}] ${item.companyName}: ${item.reason}`);
  }

  console.log(`\n=== 変更なし/情報見つからず: ${unchangedCount}件 ===`);

  if (!apply) {
    console.log(
      "\n(ドライランのため、実際の書き込みは行っていません。内容を確認して --apply を付けて再実行してください)",
    );
    return;
  }

  const latestRaw = await fetchSheetData(client, spreadsheetId, sheetName);
  const latestRows = parseSheetRows(latestRaw);
  const { writes, staleSkips } = buildFundingWrites(updateCandidates, latestRows, FUNDING_COLUMN_NAMES);

  if (staleSkips.length > 0) {
    console.log(`\n=== 書き込みスキップ(シート上の値が調査時点と変わっています): ${staleSkips.length}件 ===`);
    for (const skip of staleSkips) {
      console.log(`  [行${skip.rowIndex}] ${skip.companyName}`);
    }
  }

  if (writes.length > 0) {
    try {
      await writeCells(client, spreadsheetId, sheetName, writes, latestRaw.headerRow);
      console.log(`\n${writes.length / 4}社分の資金調達情報を書き込みました。`);
    } catch (error) {
      console.error(`\n書き込みに失敗しました: ${String(error)}`);
      throw error;
    }
  } else {
    console.log("\n書き込み対象がありませんでした。");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: `package.json`の`scripts`に追記する**

```json
"update:funding-info": "tsx scripts/updateFundingInfo.ts"
```

(既存の`"screen:non-startup": "tsx scripts/screenNonStartup.ts"`の行の直後にカンマ区切りで追加する)

- [ ] **Step 3: 型チェックを実行する**

Run: `npm run typecheck`
Expected: エラーなく終了する

- [ ] **Step 4: `data/funding-research-results.json`が無い状態でドライラン実行し、エラーメッセージを確認する**

Run: `npm run update:funding-info`
Expected: `data/funding-research-results.json が見つかりません...`というエラーで終了する(実際のSheets API呼び出しに到達しないことを確認できればよい)

- [ ] **Step 5: コミット**

```bash
git add scripts/updateFundingInfo.ts package.json
git commit -m "feat: add dry-run/apply script to reflect funding research results"
```

---

## このプラン完了後にやること(プランのスコープ外・手動実行)

上記4タスクはコードの実装のみ。実際のデータ更新は以下の手順で別途行う(本番スプレッドシートへの書き込みを伴うため、実行前にユーザーへ確認する):

1. Workflowツールで1454社分の調査を実行し、結果を`data/funding-research-results.json`に保存する
2. `npm run update:funding-info`(ドライラン)で更新候補・要目視確認件数を確認する
3. 問題なければ`npm run update:funding-info -- --apply`で反映する

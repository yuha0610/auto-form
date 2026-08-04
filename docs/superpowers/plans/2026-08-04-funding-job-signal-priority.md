# 資金調達・求人シグナル検知による優先送信 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** シート上の既存企業・Web上の新規企業について資金調達/求人の新規動きを検知し、次回の送信バッチで優先的に処理されるようにする。

**Architecture:** 既存の`updateFundingInfo.ts`と同じ「調査(Workflow、人が定期実行)→JSON保存→反映スクリプト(dry-run既定/`--apply`で書き込み)」構成を踏襲する。反映スクリプトは(1)既存企業への検知シグナル列更新、(2)新規企業の重複・競合・非スタートアップ判定を通過したものだけシートへの新規行追加、の両方を行う。シートの`selectBatch`は検知シグナルがある企業を優先して並べ替える。

**Tech Stack:** TypeScript, Node.js (tsx), Google Sheets API (googleapis), Playwright Test(ユニットテスト)

## Global Constraints

- フォローアップ間隔: `FOLLOW_UP_INTERVAL_DAYS`を`30`→`14`に変更(全企業に適用、検知シグナルによる前倒しは行わない)
- シグナルの有効期間(優先度が効く期間): `FOLLOW_UP_INTERVAL_DAYS`(14日)を流用、専用定数は追加しない
- 新規追加する列: `検知シグナル種別`(`資金調達`|`求人`) / `検知日`(`YYYY/MM/DD`) / `検知元URL`
- Workflow結果JSONの保存先: `data/signal-research-results.json`
- 反映スクリプトはdry-runが既定、`--apply`を付けたときのみシートに書き込む
- 参照する設計spec: `docs/superpowers/specs/2026-08-04-funding-job-signal-priority-design.md`

---

## ファイル構成

| ファイル | 役割 |
|---|---|
| `src/types.ts` (修正) | `COLUMNS`/`SheetRowData`に検知シグナル3列を追加 |
| `src/lib/sheetData.ts` (修正) | `parseSheetRows`で検知シグナル3列を読み取る |
| `src/lib/targetSelection.ts` (修正) | `FOLLOW_UP_INTERVAL_DAYS`を14日に変更、`hasRecentSignal`追加、`selectBatch`の優先並べ替え |
| `src/lib/signalDetection.ts` (新規) | 既存企業への検知シグナル分類・書き込み判定、新規企業の重複/競合/非スタートアップ判定、新規行データ組み立て(すべて純粋関数) |
| `src/lib/sheetsClient.ts` (修正) | `appendRows`(Sheets API `values.append`の薄いラッパー)を追加 |
| `scripts/applySignals.ts` (新規) | 調査結果JSONを読み込み、上記ライブラリを組み合わせてdry-run表示/`--apply`書き込みを行うCLIスクリプト |
| `package.json` (修正) | `apply:signals`スクリプトエントリを追加 |
| `tests/sheetData.test.ts` (修正) | 検知シグナル3列の読み取りテスト追加 |
| `tests/targetSelection.test.ts` (修正) | 14日ルールへのテスト更新、`hasRecentSignal`・優先並べ替えのテスト追加 |
| `tests/signalDetection.test.ts` (新規) | `signalDetection.ts`の全関数のユニットテスト |

---

### Task 1: データモデル拡張(検知シグナル3列の読み取り)

**Files:**
- Modify: `src/types.ts:12-43`
- Modify: `src/lib/sheetData.ts:36-69`
- Test: `tests/sheetData.test.ts`

**Interfaces:**
- Produces: `COLUMNS.signalType: "検知シグナル種別"`, `COLUMNS.signalDate: "検知日"`, `COLUMNS.signalSourceUrl: "検知元URL"`。`SheetRowData.signalType: string`, `SheetRowData.signalDate: string | null`, `SheetRowData.signalSourceUrl: string`。

- [ ] **Step 1: 失敗するテストを書く**

`tests/sheetData.test.ts`の末尾(既存の「資金調達関連4列」テストの後)に追加:

```ts
test("parseSheetRows: 検知シグナル関連3列の値を読み込む", () => {
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
    "検知シグナル種別",
    "検知日",
    "検知元URL",
  ];
  const dataRows = [
    [
      "サンプル株式会社", "https://example.com/", "", "", "", "", "", "", "",
      "", "", "", "",
      "資金調達", "2026/08/01", "https://prtimes.jp/example",
    ],
  ];
  const rows = parseSheetRows({ headerRow, dataRows });
  expect(rows[0].signalType).toBe("資金調達");
  expect(rows[0].signalDate).toBe("2026/08/01");
  expect(rows[0].signalSourceUrl).toBe("https://prtimes.jp/example");
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx playwright test tests/sheetData.test.ts -g "検知シグナル関連3列"`
Expected: FAIL(`rows[0].signalType`が`undefined`で`"資金調達"`と一致しない)

- [ ] **Step 3: 最小限の実装を書く**

`src/types.ts`の`COLUMNS`に追加(`prTimesUrl: "PRTimes URL",`の直後):

```ts
  signalType: "検知シグナル種別",
  signalDate: "検知日",
  signalSourceUrl: "検知元URL",
```

`src/types.ts`の`SheetRowData`に追加(`prTimesUrl: string;`の直後):

```ts
  signalType: string;
  signalDate: string | null;
  signalSourceUrl: string;
```

`src/lib/sheetData.ts`の`parseSheetRows`内、`col`オブジェクトに追加(`prTimesUrl: findColumnIndex(...)`の直後):

```ts
    signalType: findColumnIndex(raw.headerRow, COLUMNS.signalType),
    signalDate: findColumnIndex(raw.headerRow, COLUMNS.signalDate),
    signalSourceUrl: findColumnIndex(raw.headerRow, COLUMNS.signalSourceUrl),
```

同じ関数内、返り値のオブジェクトに追加(`prTimesUrl: cells[col.prTimesUrl] ?? "",`の直後):

```ts
    signalType: cells[col.signalType] ?? "",
    signalDate: cells[col.signalDate] || null,
    signalSourceUrl: cells[col.signalSourceUrl] ?? "",
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `npx playwright test tests/sheetData.test.ts`
Expected: 全件PASS

- [ ] **Step 5: 型チェックとコミット**

Run: `npm run typecheck`

```bash
git add src/types.ts src/lib/sheetData.ts tests/sheetData.test.ts
git commit -m "feat: add signal detection columns to SheetRowData"
```

---

### Task 2: フォローアップ間隔を14日に変更

**Files:**
- Modify: `src/lib/targetSelection.ts:13`
- Test: `tests/targetSelection.test.ts`

**Interfaces:**
- Consumes: なし(既存の`FOLLOW_UP_INTERVAL_DAYS`定数のみ変更)
- Produces: `FOLLOW_UP_INTERVAL_DAYS = 14`(以降のTaskで`hasRecentSignal`がこの値を参照する)

- [ ] **Step 1: 既存テストを14日基準に書き換える(失敗させる)**

`tests/targetSelection.test.ts`の以下3テストを置き換える:

```ts
test("getNextAttempt: 1回目から14日未満なら2回目は対象外", () => {
  const row = makeRow({ firstSentAt: "2026/07/01" });
  const notYet = new Date(2026, 6, 10); // 9日後
  expect(getNextAttempt(row, notYet)).toBeNull();
});

test("getNextAttempt: 1回目から14日以上経過していれば2回目が対象", () => {
  const row = makeRow({ firstSentAt: "2026/07/01" });
  const today = new Date(2026, 6, 15); // 14日後
  expect(getNextAttempt(row, today)).toBe(2);
});

test("getNextAttempt: 2回目から14日以上経過していれば3回目が対象", () => {
  const row = makeRow({
    firstSentAt: "2026/05/01",
    secondSentAt: "2026/07/01",
  });
  const today = new Date(2026, 6, 15); // 2回目から14日後
  expect(getNextAttempt(row, today)).toBe(3);
});
```

(元の「1回目から30日未満なら2回目は対象外」「1回目から30日以上経過していれば2回目が対象」「2回目から30日以上経過していれば3回目が対象」の3テストをこれに差し替える)

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx playwright test tests/targetSelection.test.ts -g "14日"`
Expected: 「14日以上経過していれば2回目が対象」「3回目が対象」の2件がFAIL(現行コードは30日基準のため`null`が返り`2`/`3`と一致しない)

- [ ] **Step 3: 実装を変更する**

`src/lib/targetSelection.ts:13`:

```ts
const FOLLOW_UP_INTERVAL_DAYS = 14;
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `npx playwright test tests/targetSelection.test.ts`
Expected: 全件PASS

- [ ] **Step 5: コミット**

```bash
git add src/lib/targetSelection.ts tests/targetSelection.test.ts
git commit -m "feat: shorten follow-up interval from 30 to 14 days"
```

---

### Task 3: `hasRecentSignal`と`selectBatch`の優先並べ替え

**Files:**
- Modify: `src/lib/targetSelection.ts`(`getNextAttempt`の後に`hasRecentSignal`を追加、`selectBatch`を変更)
- Test: `tests/targetSelection.test.ts`

**Interfaces:**
- Consumes: `SheetRowData.signalDate`(Task 1)、`FOLLOW_UP_INTERVAL_DAYS`(Task 2)
- Produces: `hasRecentSignal(row: SheetRowData, today: Date): boolean`。`selectBatch`は返り値の順序が「検知シグナルあり→なし」になる(シグネチャは変更なし)。

- [ ] **Step 1: `makeRow`に検知シグナル3列を追加し、失敗するテストを書く**

`tests/targetSelection.test.ts`の`makeRow`関数を以下に置き換える:

```ts
function makeRow(overrides: Partial<SheetRowData>): SheetRowData {
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
    signalType: "",
    signalDate: null,
    signalSourceUrl: "",
    ...overrides,
  };
}
```

同ファイル末尾(`summarizeSkipped`のテスト群の後)に追加:

```ts
test("hasRecentSignal: 検知日が14日以内ならtrue", () => {
  const row = makeRow({ signalDate: "2026/07/01" });
  const today = new Date(2026, 6, 15); // 14日後
  expect(hasRecentSignal(row, today)).toBe(true);
});

test("hasRecentSignal: 検知日が14日を超えていればfalse", () => {
  const row = makeRow({ signalDate: "2026/07/01" });
  const today = new Date(2026, 6, 16); // 15日後
  expect(hasRecentSignal(row, today)).toBe(false);
});

test("hasRecentSignal: 検知日が無ければfalse", () => {
  const row = makeRow({ signalDate: null });
  expect(hasRecentSignal(row, new Date(2026, 6, 15))).toBe(false);
});

test("selectBatch: 検知シグナルがある対象を先頭に並べ替える", () => {
  const rows = [
    makeRow({ rowIndex: 2, companyName: "A" }),
    makeRow({ rowIndex: 3, companyName: "B", signalDate: "2026/07/10" }),
    makeRow({ rowIndex: 4, companyName: "C" }),
  ];
  const today = new Date(2026, 6, 15); // Bの検知日から5日後(14日以内)
  const batch = selectBatch(rows, 3, today);
  expect(batch.map((t) => t.row.companyName)).toEqual(["B", "A", "C"]);
});
```

`import`文に`hasRecentSignal`を追加:

```ts
import {
  parseSheetDate,
  formatSheetDate,
  isSkipped,
  getNextAttempt,
  hasRecentSignal,
  selectBatch,
  dedupeByCompanyName,
  summarizeSkipped,
} from "../src/lib/targetSelection.js";
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx playwright test tests/targetSelection.test.ts -g "hasRecentSignal|検知シグナルがある対象"`
Expected: `hasRecentSignal`が存在せずエラー(モジュールが該当exportを提供しない)

- [ ] **Step 3: 実装を追加する**

`src/lib/targetSelection.ts`の`getNextAttempt`関数の直後に追加:

```ts
export function hasRecentSignal(row: SheetRowData, today: Date): boolean {
  const signalDate = parseSheetDate(row.signalDate);
  if (!signalDate) return false;
  return daysBetween(signalDate, today) <= FOLLOW_UP_INTERVAL_DAYS;
}
```

`selectBatch`関数を以下に置き換える:

```ts
export function selectBatch(
  rows: SheetRowData[],
  batchSize: number,
  today: Date,
): EligibleTarget[] {
  const eligible: EligibleTarget[] = [];
  for (const row of rows) {
    const attemptNumber = getNextAttempt(row, today);
    if (attemptNumber !== null) {
      eligible.push({ row, attemptNumber });
    }
  }

  const sorted = [...eligible].sort((a, b) => {
    const aHot = hasRecentSignal(a.row, today) ? 0 : 1;
    const bHot = hasRecentSignal(b.row, today) ? 0 : 1;
    return aHot - bHot;
  });

  return sorted.slice(0, batchSize);
}
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `npx playwright test tests/targetSelection.test.ts`
Expected: 全件PASS(既存の「selectBatch: 対象行を先頭からbatchSize件だけ返す」も回帰なくPASSすることを確認)

- [ ] **Step 5: 型チェックとコミット**

Run: `npm run typecheck`

```bash
git add src/lib/targetSelection.ts tests/targetSelection.test.ts
git commit -m "feat: prioritize rows with a recent funding/job signal in selectBatch"
```

---

### Task 4: 既存企業への検知シグナル分類・書き込み判定(`signalDetection.ts`前半)

**Files:**
- Create: `src/lib/signalDetection.ts`
- Test: `tests/signalDetection.test.ts`

**Interfaces:**
- Consumes: `COLUMNS`/`SheetRowData`(`src/types.ts`)、`normalizeCellText`(`src/lib/textNormalize.ts`)、`parseSheetDate`(`src/lib/targetSelection.ts`)
- Produces: `SignalFields`, `SIGNAL_COLUMN_NAMES`, `ExistingSignalResult`, `SignalUpdateCandidate`, `SignalReviewItem`, `SignalClassification`, `classifyExistingSignals(results: ExistingSignalResult[], rows: SheetRowData[]): SignalClassification`, `StaleSkip`, `SignalWritePlan`, `buildSignalWrites(candidates: SignalUpdateCandidate[], currentRows: SheetRowData[], columnNames: SignalFields): SignalWritePlan`。Task 5でこのファイルに追記する。

- [ ] **Step 1: 失敗するテストを書く**

`tests/signalDetection.test.ts`を新規作成:

```ts
import { test, expect } from "@playwright/test";
import {
  classifyExistingSignals,
  buildSignalWrites,
  SIGNAL_COLUMN_NAMES,
  type ExistingSignalResult,
} from "../src/lib/signalDetection.js";
import { COLUMNS } from "../src/types.js";
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
    fundingAmount: "",
    fundingRound: "",
    fundingMonth: "",
    prTimesUrl: "",
    signalType: "",
    signalDate: null,
    signalSourceUrl: "",
    ...overrides,
  };
}

test("classifyExistingSignals: 検知日がシート上の値より新しければ更新候補になる", () => {
  const rows = [makeRow({ signalDate: "2026/07/01", signalType: "求人", signalSourceUrl: "https://old.example.com" })];
  const results: ExistingSignalResult[] = [
    {
      rowIndex: 2,
      companyName: "サンプル株式会社",
      signalType: "資金調達",
      signalDate: "2026/08/01",
      sourceUrl: "https://prtimes.jp/new",
      confidence: "high",
      reason: "PR TIMESで確認",
    },
  ];

  const { updateCandidates, needsReview, unchangedCount } = classifyExistingSignals(results, rows);

  expect(updateCandidates).toEqual([
    {
      rowIndex: 2,
      companyName: "サンプル株式会社",
      before: { signalType: "求人", signalDate: "2026/07/01", signalSourceUrl: "https://old.example.com" },
      after: { signalType: "資金調達", signalDate: "2026/08/01", signalSourceUrl: "https://prtimes.jp/new" },
    },
  ]);
  expect(needsReview).toEqual([]);
  expect(unchangedCount).toBe(0);
});

test("classifyExistingSignals: 検知日がシート上の値と同じかそれより古い場合は変更なしに分類される", () => {
  const rows = [makeRow({ signalDate: "2026/08/01" })];
  const results: ExistingSignalResult[] = [
    {
      rowIndex: 2,
      companyName: "サンプル株式会社",
      signalType: "資金調達",
      signalDate: "2026/08/01",
      sourceUrl: "https://prtimes.jp/new",
      confidence: "high",
      reason: "同じ検知結果",
    },
  ];

  const { updateCandidates, unchangedCount } = classifyExistingSignals(results, rows);

  expect(updateCandidates).toEqual([]);
  expect(unchangedCount).toBe(1);
});

test("classifyExistingSignals: confidenceがlowなら要確認に回す", () => {
  const rows = [makeRow()];
  const results: ExistingSignalResult[] = [
    {
      rowIndex: 2,
      companyName: "サンプル株式会社",
      signalType: "求人",
      signalDate: "2026/08/01",
      sourceUrl: "https://example.com/jobs",
      confidence: "low",
      reason: "求人媒体1件のみで確信が持てない",
    },
  ];

  const { updateCandidates, needsReview } = classifyExistingSignals(results, rows);

  expect(updateCandidates).toEqual([]);
  expect(needsReview).toEqual([
    { rowIndex: 2, companyName: "サンプル株式会社", reason: "求人媒体1件のみで確信が持てない" },
  ]);
});

test("classifyExistingSignals: シート上に該当行が無い結果は要確認に回す", () => {
  const rows = [makeRow({ rowIndex: 2 })];
  const results: ExistingSignalResult[] = [
    {
      rowIndex: 999,
      companyName: "消えた株式会社",
      signalType: "資金調達",
      signalDate: "2026/08/01",
      sourceUrl: "https://prtimes.jp/x",
      confidence: "high",
      reason: "調べたが該当行なし",
    },
  ];

  const { needsReview } = classifyExistingSignals(results, rows);

  expect(needsReview).toEqual([
    { rowIndex: 999, companyName: "消えた株式会社", reason: "シート上に該当行が見つかりません" },
  ]);
});

test("buildSignalWrites: 現在値がbeforeと一致すれば3列分の書き込みを生成する", () => {
  const candidates = [
    {
      rowIndex: 2,
      companyName: "サンプル株式会社",
      before: { signalType: "求人", signalDate: "2026/07/01", signalSourceUrl: "https://old.example.com" },
      after: { signalType: "資金調達", signalDate: "2026/08/01", signalSourceUrl: "https://prtimes.jp/new" },
    },
  ];
  const currentRows = [
    makeRow({ rowIndex: 2, signalType: "求人", signalDate: "2026/07/01", signalSourceUrl: "https://old.example.com" }),
  ];

  const { writes, staleSkips } = buildSignalWrites(candidates, currentRows, SIGNAL_COLUMN_NAMES);

  expect(staleSkips).toEqual([]);
  expect(writes).toEqual([
    { rowIndex: 2, columnName: COLUMNS.signalType, value: "資金調達" },
    { rowIndex: 2, columnName: COLUMNS.signalDate, value: "2026/08/01" },
    { rowIndex: 2, columnName: COLUMNS.signalSourceUrl, value: "https://prtimes.jp/new" },
  ]);
});

test("buildSignalWrites: 現在値がbeforeと異なる(手動編集済み)行はスキップされる", () => {
  const candidates = [
    {
      rowIndex: 2,
      companyName: "サンプル株式会社",
      before: { signalType: "求人", signalDate: "2026/07/01", signalSourceUrl: "https://old.example.com" },
      after: { signalType: "資金調達", signalDate: "2026/08/01", signalSourceUrl: "https://prtimes.jp/new" },
    },
  ];
  const currentRows = [
    makeRow({ rowIndex: 2, signalType: "求人", signalDate: "2026/07/20", signalSourceUrl: "https://old.example.com" }),
  ];

  const { writes, staleSkips } = buildSignalWrites(candidates, currentRows, SIGNAL_COLUMN_NAMES);

  expect(writes).toEqual([]);
  expect(staleSkips).toEqual([{ rowIndex: 2, companyName: "サンプル株式会社", reason: "valueChanged" }]);
});

test("buildSignalWrites: 行がズレて企業名が一致しない場合は書き込みをスキップする", () => {
  const candidates = [
    {
      rowIndex: 2,
      companyName: "サンプル株式会社",
      before: { signalType: "", signalDate: "", signalSourceUrl: "" },
      after: { signalType: "資金調達", signalDate: "2026/08/01", signalSourceUrl: "https://prtimes.jp/new" },
    },
  ];
  const currentRows = [makeRow({ rowIndex: 2, companyName: "別の株式会社" })];

  const { writes, staleSkips } = buildSignalWrites(candidates, currentRows, SIGNAL_COLUMN_NAMES);

  expect(writes).toEqual([]);
  expect(staleSkips).toEqual([{ rowIndex: 2, companyName: "サンプル株式会社", reason: "companyMismatch" }]);
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx playwright test tests/signalDetection.test.ts`
Expected: FAIL(モジュール`../src/lib/signalDetection.js`が存在しない)

- [ ] **Step 3: 実装を書く**

`src/lib/signalDetection.ts`を新規作成:

```ts
import { COLUMNS, type SheetRowData } from "../types.js";
import { normalizeCellText } from "./textNormalize.js";
import { parseSheetDate } from "./targetSelection.js";

export interface SignalFields {
  signalType: string;
  signalDate: string;
  signalSourceUrl: string;
}

/** 検知シグナル関連3列のヘッダー名。スクリプト/テスト双方から共通で参照する。 */
export const SIGNAL_COLUMN_NAMES: SignalFields = {
  signalType: COLUMNS.signalType,
  signalDate: COLUMNS.signalDate,
  signalSourceUrl: COLUMNS.signalSourceUrl,
};

export interface ExistingSignalResult {
  rowIndex: number;
  companyName: string;
  signalType: string;
  signalDate: string;
  sourceUrl: string;
  confidence: "high" | "low";
  reason: string;
}

export interface SignalUpdateCandidate {
  rowIndex: number;
  companyName: string;
  before: SignalFields;
  after: SignalFields;
}

export interface SignalReviewItem {
  rowIndex: number;
  companyName: string;
  reason: string;
}

export interface SignalClassification {
  updateCandidates: SignalUpdateCandidate[];
  needsReview: SignalReviewItem[];
  unchangedCount: number;
}

function isNewerSignal(candidateDateRaw: string, currentDateRaw: string | null): boolean {
  const candidateDate = parseSheetDate(candidateDateRaw);
  if (!candidateDate) return false;
  const currentDate = parseSheetDate(currentDateRaw);
  if (!currentDate) return true;
  return candidateDate.getTime() > currentDate.getTime();
}

/** 資金調達/求人の検知結果を、シートの現在行と突き合わせて更新候補/要確認/変更なしに分類する。 */
export function classifyExistingSignals(
  results: ExistingSignalResult[],
  rows: SheetRowData[],
): SignalClassification {
  const rowByIndex = new Map(rows.map((row) => [row.rowIndex, row]));
  const updateCandidates: SignalUpdateCandidate[] = [];
  const needsReview: SignalReviewItem[] = [];
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

    if (!isNewerSignal(result.signalDate, row.signalDate)) {
      unchangedCount++;
      continue;
    }

    updateCandidates.push({
      rowIndex: result.rowIndex,
      companyName: result.companyName,
      before: {
        signalType: row.signalType,
        signalDate: row.signalDate ?? "",
        signalSourceUrl: row.signalSourceUrl,
      },
      after: {
        signalType: result.signalType,
        signalDate: result.signalDate,
        signalSourceUrl: result.sourceUrl,
      },
    });
  }

  return { updateCandidates, needsReview, unchangedCount };
}

export interface StaleSkip {
  rowIndex: number;
  companyName: string;
  reason: "companyMismatch" | "valueChanged";
}

export interface SignalWritePlan {
  writes: { rowIndex: number; columnName: string; value: string }[];
  staleSkips: StaleSkip[];
}

/**
 * 書き込み直前の現在シート値と、分類時点のスナップショットである`before`を、
 * 企業名と検知シグナル3列の両方について比較し、一致するものだけ書き込み対象にする。
 */
export function buildSignalWrites(
  candidates: SignalUpdateCandidate[],
  currentRows: SheetRowData[],
  columnNames: SignalFields,
): SignalWritePlan {
  const currentByIndex = new Map(currentRows.map((row) => [row.rowIndex, row]));
  const writes: SignalWritePlan["writes"] = [];
  const staleSkips: StaleSkip[] = [];

  for (const candidate of candidates) {
    const current = currentByIndex.get(candidate.rowIndex);

    if (current === undefined) {
      staleSkips.push({ rowIndex: candidate.rowIndex, companyName: candidate.companyName, reason: "valueChanged" });
      continue;
    }

    const companyMatches =
      normalizeCellText(current.companyName) === normalizeCellText(candidate.companyName);

    if (!companyMatches) {
      staleSkips.push({ rowIndex: candidate.rowIndex, companyName: candidate.companyName, reason: "companyMismatch" });
      continue;
    }

    const valuesMatch =
      current.signalType === candidate.before.signalType &&
      (current.signalDate ?? "") === candidate.before.signalDate &&
      current.signalSourceUrl === candidate.before.signalSourceUrl;

    if (!valuesMatch) {
      staleSkips.push({ rowIndex: candidate.rowIndex, companyName: candidate.companyName, reason: "valueChanged" });
      continue;
    }

    writes.push({ rowIndex: candidate.rowIndex, columnName: columnNames.signalType, value: candidate.after.signalType });
    writes.push({ rowIndex: candidate.rowIndex, columnName: columnNames.signalDate, value: candidate.after.signalDate });
    writes.push({ rowIndex: candidate.rowIndex, columnName: columnNames.signalSourceUrl, value: candidate.after.signalSourceUrl });
  }

  return { writes, staleSkips };
}
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `npx playwright test tests/signalDetection.test.ts`
Expected: 全件PASS

- [ ] **Step 5: 型チェックとコミット**

Run: `npm run typecheck`

```bash
git add src/lib/signalDetection.ts tests/signalDetection.test.ts
git commit -m "feat: classify and build write-plan for existing-company signal detection"
```

---

### Task 5: 新規企業の重複/競合/非スタートアップ判定・新規行データ組み立て(`signalDetection.ts`後半)

**Files:**
- Modify: `src/lib/signalDetection.ts`(追記)
- Test: `tests/signalDetection.test.ts`(追記)

**Interfaces:**
- Consumes: `extractCompanyCoreName`(`src/lib/textNormalize.ts`)、`matchCompanyName`(`src/lib/competitorScreening.ts`、`src/lib/nonStartupScreening.ts` — 両方とも同名exportのためインポート時にエイリアス)、`findColumnIndex`(`src/lib/sheetData.ts`)、Task 4の`COLUMNS`
- Produces: `NewCandidateResult`, `NewCompanyRow`, `NewRowReviewItem`, `NewCandidateClassification`, `classifyNewCandidates(candidates: NewCandidateResult[], existingRows: SheetRowData[]): NewCandidateClassification`, `buildNewRowValues(row: NewCompanyRow, headerRow: string[]): string[]`。Task 7で`scripts/applySignals.ts`から使う。

- [ ] **Step 1: 失敗するテストを書く**

`tests/signalDetection.test.ts`の末尾に追加:

```ts
import {
  classifyNewCandidates,
  buildNewRowValues,
  type NewCandidateResult,
  type NewCompanyRow,
} from "../src/lib/signalDetection.js";

test("classifyNewCandidates: confidenceがlowなら要確認に回す", () => {
  const results: NewCandidateResult[] = [
    {
      companyName: "新規株式会社",
      companyUrl: "https://example.com/",
      signalType: "資金調達",
      signalDate: "2026/08/01",
      sourceUrl: "https://prtimes.jp/x",
      confidence: "low",
      reason: "ソース1件のみ",
    },
  ];
  const { provisionalRows, needsReview } = classifyNewCandidates(results, []);
  expect(provisionalRows).toEqual([]);
  expect(needsReview).toEqual([{ companyName: "新規株式会社", reason: "ソース1件のみ" }]);
});

test("classifyNewCandidates: 既存シートに同名企業(表記ゆれ含む)があれば要確認に回す", () => {
  const existingRows = [makeRow({ companyName: "サンプル株式会社" })];
  const results: NewCandidateResult[] = [
    {
      companyName: "株式会社サンプル",
      companyUrl: "https://example.com/",
      signalType: "求人",
      signalDate: "2026/08/01",
      sourceUrl: "https://example.com/jobs",
      confidence: "high",
      reason: "Wantedlyで新規掲載",
    },
  ];
  const { provisionalRows, needsReview } = classifyNewCandidates(results, existingRows);
  expect(provisionalRows).toEqual([]);
  expect(needsReview).toEqual([{ companyName: "株式会社サンプル", reason: "既存シートに同名企業が存在" }]);
});

test("classifyNewCandidates: 企業名が競合キーワードに一致すれば要確認に回す", () => {
  const results: NewCandidateResult[] = [
    {
      companyName: "株式会社ABC人材紹介",
      companyUrl: "https://example.com/",
      signalType: "資金調達",
      signalDate: "2026/08/01",
      sourceUrl: "https://prtimes.jp/x",
      confidence: "high",
      reason: "PR TIMESで確認",
    },
  ];
  const { provisionalRows, needsReview } = classifyNewCandidates(results, []);
  expect(provisionalRows).toEqual([]);
  expect(needsReview).toEqual([{ companyName: "株式会社ABC人材紹介", reason: "企業名に「人材紹介」(競合)" }]);
});

test("classifyNewCandidates: 企業名が非スタートアップキーワードに一致すれば要確認に回す", () => {
  const results: NewCandidateResult[] = [
    {
      companyName: "株式会社ABC学習塾",
      companyUrl: "https://example.com/",
      signalType: "求人",
      signalDate: "2026/08/01",
      sourceUrl: "https://example.com/jobs",
      confidence: "high",
      reason: "Greenで新規掲載",
    },
  ];
  const { provisionalRows, needsReview } = classifyNewCandidates(results, []);
  expect(provisionalRows).toEqual([]);
  expect(needsReview).toEqual([{ companyName: "株式会社ABC学習塾", reason: "企業名に「学習塾」(非スタートアップ)" }]);
});

test("classifyNewCandidates: 上記すべてを通過すれば新規行の候補になる", () => {
  const results: NewCandidateResult[] = [
    {
      companyName: "新規株式会社",
      companyUrl: "https://newco.example.com/",
      signalType: "資金調達",
      signalDate: "2026/08/01",
      sourceUrl: "https://prtimes.jp/x",
      confidence: "high",
      reason: "PR TIMESで確認",
    },
  ];
  const { provisionalRows, needsReview } = classifyNewCandidates(results, []);
  expect(needsReview).toEqual([]);
  expect(provisionalRows).toEqual([
    {
      companyName: "新規株式会社",
      companyUrl: "https://newco.example.com/",
      signalType: "資金調達",
      signalDate: "2026/08/01",
      signalSourceUrl: "https://prtimes.jp/x",
    },
  ]);
});

test("buildNewRowValues: ヘッダー順に値をマッピングし、対象外の列は空文字にする", () => {
  const headerRow = [
    COLUMNS.companyName, COLUMNS.companyUrl, COLUMNS.formUrl, COLUMNS.note, COLUMNS.dealStatus,
    COLUMNS.firstSent, COLUMNS.secondSent, COLUMNS.thirdSent, COLUMNS.email,
    COLUMNS.fundingAmount, COLUMNS.fundingRound, COLUMNS.fundingMonth, COLUMNS.prTimesUrl,
    COLUMNS.signalType, COLUMNS.signalDate, COLUMNS.signalSourceUrl,
  ];
  const row: NewCompanyRow = {
    companyName: "新規株式会社",
    companyUrl: "https://newco.example.com/",
    signalType: "資金調達",
    signalDate: "2026/08/01",
    signalSourceUrl: "https://prtimes.jp/x",
  };
  const values = buildNewRowValues(row, headerRow);
  expect(values).toEqual([
    "新規株式会社", "https://newco.example.com/", "", "", "",
    "", "", "", "",
    "", "", "", "",
    "資金調達", "2026/08/01", "https://prtimes.jp/x",
  ]);
});
```

(このファイルは既にTask 4で`makeRow`ヘルパーと1つ目の`import { ... } from "../src/lib/signalDetection.js"`を定義済みなので、上の2つ目の`import`ブロックは既存のimport文に追記してまとめる。`classifyExistingSignals`, `buildSignalWrites`, `SIGNAL_COLUMN_NAMES`と同じ`import`文に`classifyNewCandidates`, `buildNewRowValues`, `type NewCandidateResult`, `type NewCompanyRow`を追加すればよい)

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx playwright test tests/signalDetection.test.ts -g "classifyNewCandidates|buildNewRowValues"`
Expected: FAIL(`classifyNewCandidates`/`buildNewRowValues`が存在しない)

- [ ] **Step 3: 実装を追記する**

`src/lib/signalDetection.ts`のimport文を以下に置き換える:

```ts
import { COLUMNS, type SheetRowData } from "../types.js";
import { normalizeCellText, extractCompanyCoreName } from "./textNormalize.js";
import { parseSheetDate } from "./targetSelection.js";
import { findColumnIndex } from "./sheetData.js";
import { matchCompanyName as matchCompetitorName } from "./competitorScreening.js";
import { matchCompanyName as matchNonStartupName } from "./nonStartupScreening.js";
```

ファイル末尾に追加:

```ts
export interface NewCandidateResult {
  companyName: string;
  companyUrl: string;
  signalType: string;
  signalDate: string;
  sourceUrl: string;
  confidence: "high" | "low";
  reason: string;
}

export interface NewCompanyRow {
  companyName: string;
  companyUrl: string;
  signalType: string;
  signalDate: string;
  signalSourceUrl: string;
}

export interface NewRowReviewItem {
  companyName: string;
  reason: string;
}

export interface NewCandidateClassification {
  provisionalRows: NewCompanyRow[];
  needsReview: NewRowReviewItem[];
}

/**
 * 資金調達/求人で新規発掘した企業を、confidence・既存シートとの重複(企業名の表記ゆれ含む)・
 * 競合/非スタートアップの企業名キーワードで判定する。
 * ページ内容によるキーワード判定はI/O(URL取得)を伴うためこの関数の対象外とし、
 * 呼び出し側(scripts/applySignals.ts)で`provisionalRows`に対して別途行う。
 */
export function classifyNewCandidates(
  candidates: NewCandidateResult[],
  existingRows: SheetRowData[],
): NewCandidateClassification {
  const existingCoreNames = new Set(
    existingRows.map((row) => extractCompanyCoreName(row.companyName)).filter((name) => name !== ""),
  );

  const provisionalRows: NewCompanyRow[] = [];
  const needsReview: NewRowReviewItem[] = [];

  for (const candidate of candidates) {
    if (candidate.confidence === "low") {
      needsReview.push({ companyName: candidate.companyName, reason: candidate.reason });
      continue;
    }

    const coreName = extractCompanyCoreName(candidate.companyName);
    if (coreName !== "" && existingCoreNames.has(coreName)) {
      needsReview.push({ companyName: candidate.companyName, reason: "既存シートに同名企業が存在" });
      continue;
    }

    const competitorMatch = matchCompetitorName(candidate.companyName);
    if (competitorMatch) {
      needsReview.push({ companyName: candidate.companyName, reason: `企業名に「${competitorMatch}」(競合)` });
      continue;
    }

    const nonStartupMatch = matchNonStartupName(candidate.companyName);
    if (nonStartupMatch) {
      needsReview.push({ companyName: candidate.companyName, reason: `企業名に「${nonStartupMatch}」(非スタートアップ)` });
      continue;
    }

    provisionalRows.push({
      companyName: candidate.companyName,
      companyUrl: candidate.companyUrl,
      signalType: candidate.signalType,
      signalDate: candidate.signalDate,
      signalSourceUrl: candidate.sourceUrl,
    });
  }

  return { provisionalRows, needsReview };
}

/** ヘッダー順に合わせて新規行の値配列を組み立てる(該当しない列は空文字)。 */
export function buildNewRowValues(row: NewCompanyRow, headerRow: string[]): string[] {
  const values = new Array(headerRow.length).fill("");
  values[findColumnIndex(headerRow, COLUMNS.companyName)] = row.companyName;
  values[findColumnIndex(headerRow, COLUMNS.companyUrl)] = row.companyUrl;
  values[findColumnIndex(headerRow, COLUMNS.signalType)] = row.signalType;
  values[findColumnIndex(headerRow, COLUMNS.signalDate)] = row.signalDate;
  values[findColumnIndex(headerRow, COLUMNS.signalSourceUrl)] = row.signalSourceUrl;
  return values;
}
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `npx playwright test tests/signalDetection.test.ts`
Expected: 全件PASS

- [ ] **Step 5: 型チェックとコミット**

Run: `npm run typecheck`

```bash
git add src/lib/signalDetection.ts tests/signalDetection.test.ts
git commit -m "feat: screen and build sheet rows for newly discovered companies"
```

---

### Task 6: `sheetsClient.ts`に`appendRows`を追加

**Files:**
- Modify: `src/lib/sheetsClient.ts`(末尾に追加)

**Interfaces:**
- Produces: `appendRows(client: sheets_v4.Sheets, spreadsheetId: string, sheetName: string, rows: string[][]): Promise<void>`

このタスクにはテストが無い。既存の`writeCells`/`deleteRows`と同じく、実際のSheets APIを呼ぶ薄いラッパーであり、判定ロジックはすべて`signalDetection.ts`の純粋関数側でテスト済みのため(spec「テスト方針」節の決定に基づく)。

- [ ] **Step 1: 実装を追加する**

`src/lib/sheetsClient.ts`の末尾に追加:

```ts
/** シート末尾に新規行を追加する(1行=1配列、複数行まとめて渡せる)。 */
export async function appendRows(
  client: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string,
  rows: string[][],
): Promise<void> {
  if (rows.length === 0) return;

  await client.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A1`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows },
  });
}
```

- [ ] **Step 2: 型チェック**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 3: コミット**

```bash
git add src/lib/sheetsClient.ts
git commit -m "feat: add appendRows for inserting newly discovered companies"
```

---

### Task 7: 反映スクリプト`scripts/applySignals.ts`

**Files:**
- Create: `scripts/applySignals.ts`
- Modify: `package.json`(`scripts`に追加)

**Interfaces:**
- Consumes: Task 1-6で作った全関数(`classifyExistingSignals`, `buildSignalWrites`, `classifyNewCandidates`, `buildNewRowValues`, `SIGNAL_COLUMN_NAMES`, `appendRows`, 既存の`createSheetsClient`/`fetchSheetData`/`getFirstSheetName`/`writeCells`/`parseSheetRows`)、`matchPageContent`(`competitorScreening.ts`/`nonStartupScreening.ts`)、`resolveOverviewUrl`(`competitorScreening.ts`)
- Produces: CLIスクリプト(他のタスクからは参照されない)

このタスクは実APIを呼ぶ統合スクリプトのため、Step 1-4は自動テストではなく手動での動作確認とする(既存の`scripts/updateFundingInfo.ts`と同方針)。

- [ ] **Step 1: スクリプトを作成する**

`scripts/applySignals.ts`を新規作成:

```ts
import "dotenv/config";
import { readFile } from "node:fs/promises";
import {
  createSheetsClient,
  fetchSheetData,
  getFirstSheetName,
  writeCells,
  appendRows,
} from "../src/lib/sheetsClient.js";
import { parseSheetRows } from "../src/lib/sheetData.js";
import {
  classifyExistingSignals,
  buildSignalWrites,
  classifyNewCandidates,
  buildNewRowValues,
  SIGNAL_COLUMN_NAMES,
  type ExistingSignalResult,
  type NewCandidateResult,
  type NewCompanyRow,
  type NewRowReviewItem,
} from "../src/lib/signalDetection.js";
import { matchPageContent as matchCompetitorPageContent, resolveOverviewUrl } from "../src/lib/competitorScreening.js";
import { matchPageContent as matchNonStartupPageContent } from "../src/lib/nonStartupScreening.js";

const RESULTS_PATH = "data/signal-research-results.json";
const TIMEOUT_MS = 10_000;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

interface SignalResearchResult {
  existingSignals: ExistingSignalResult[];
  newCandidates: NewCandidateResult[];
}

async function loadResults(): Promise<SignalResearchResult> {
  try {
    const content = await readFile(RESULTS_PATH, "utf-8");
    return JSON.parse(content) as SignalResearchResult;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      throw new Error(
        `${RESULTS_PATH} が見つかりません。先にWorkflowで調査を実行し、結果をこのパスに保存してください`,
      );
    }
    throw error;
  }
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "follow",
  });
  return await res.text();
}

async function passesContentScreening(row: NewCompanyRow): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!row.companyUrl) return { ok: true };

  try {
    const topHtml = await fetchText(row.companyUrl);
    let combined = topHtml;

    const overviewUrl = resolveOverviewUrl(row.companyUrl, topHtml);
    if (overviewUrl) {
      try {
        combined += "\n" + (await fetchText(overviewUrl));
      } catch {
        // 概要ページの取得に失敗した場合はトップページのみで判定する
      }
    }

    const competitorMatch = matchCompetitorPageContent(combined);
    if (competitorMatch) {
      return { ok: false, reason: `ページ内容に「${competitorMatch.keyword}」(競合)` };
    }

    const nonStartupMatch = matchNonStartupPageContent(combined);
    if (nonStartupMatch) {
      return { ok: false, reason: `ページ内容に「${nonStartupMatch.keyword}」(非スタートアップ)` };
    }

    return { ok: true };
  } catch {
    return { ok: true };
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

  const { updateCandidates, needsReview: existingNeedsReview, unchangedCount } =
    classifyExistingSignals(results.existingSignals, rows);

  console.log(`=== 既存企業・更新候補: ${updateCandidates.length}件 ===`);
  for (const candidate of updateCandidates) {
    console.log(`  [行${candidate.rowIndex}] ${candidate.companyName}`);
    console.log(`    検知シグナル種別: "${candidate.before.signalType}" -> "${candidate.after.signalType}"`);
    console.log(`    検知日: "${candidate.before.signalDate}" -> "${candidate.after.signalDate}"`);
    console.log(`    検知元URL: "${candidate.before.signalSourceUrl}" -> "${candidate.after.signalSourceUrl}"`);
  }

  if (existingNeedsReview.length > 0) {
    console.log(`\n=== 既存企業・要確認: ${existingNeedsReview.length}件 ===`);
    for (const item of existingNeedsReview) {
      console.log(`  [行${item.rowIndex}] ${item.companyName}: ${item.reason}`);
    }
  }

  const { provisionalRows, needsReview: newCandidateNeedsReview } =
    classifyNewCandidates(results.newCandidates, rows);

  const newRows: NewCompanyRow[] = [];
  const contentReview: NewRowReviewItem[] = [];
  for (const row of provisionalRows) {
    const screening = await passesContentScreening(row);
    if (screening.ok) {
      newRows.push(row);
    } else {
      contentReview.push({ companyName: row.companyName, reason: screening.reason });
    }
  }

  console.log(`\n=== 新規追加候補: ${newRows.length}件 ===`);
  for (const row of newRows) {
    console.log(`  ${row.companyName} (${row.companyUrl})`);
    console.log(`    検知シグナル種別: ${row.signalType} / 検知日: ${row.signalDate} / URL: ${row.signalSourceUrl}`);
  }

  const newCompanyReview = [...newCandidateNeedsReview, ...contentReview];
  if (newCompanyReview.length > 0) {
    console.log(`\n=== 新規企業・要確認: ${newCompanyReview.length}件 ===`);
    for (const item of newCompanyReview) {
      console.log(`  ${item.companyName}: ${item.reason}`);
    }
  }

  console.log(`\n=== 変更なし: ${unchangedCount}件 ===`);

  if (!apply) {
    console.log("\n--apply を付けずに実行したため、シートへの書き込みは行っていません。");
    return;
  }

  const currentRaw = await fetchSheetData(client, spreadsheetId, sheetName);
  const currentRows = parseSheetRows(currentRaw);

  const { writes, staleSkips } = buildSignalWrites(updateCandidates, currentRows, SIGNAL_COLUMN_NAMES);
  if (staleSkips.length > 0) {
    console.log(`\n書き込み直前の再確認でスキップした行: ${staleSkips.length}件`);
    for (const skip of staleSkips) {
      console.log(`  [行${skip.rowIndex}] ${skip.companyName}: ${skip.reason}`);
    }
  }
  await writeCells(client, spreadsheetId, sheetName, writes, currentRaw.headerRow);
  console.log(`\n既存企業へのシグナル反映: ${updateCandidates.length - staleSkips.length}件`);

  if (newRows.length > 0) {
    const rowValues = newRows.map((row) => buildNewRowValues(row, currentRaw.headerRow));
    await appendRows(client, spreadsheetId, sheetName, rowValues);
    console.log(`新規企業の追加: ${newRows.length}件`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: `package.json`にスクリプトエントリを追加する**

`package.json`の`scripts`に追加(`"update:funding-info": "tsx scripts/updateFundingInfo.ts"`の直後):

```json
    "apply:signals": "tsx scripts/applySignals.ts",
```

- [ ] **Step 3: 型チェックを実行する**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 4: 空データでdry-runを手動確認する**

一時的なフィクスチャを作成して実行する(実データは書き込まれない。`--apply`を付けていないため):

```bash
echo '{"existingSignals": [], "newCandidates": []}' > data/signal-research-results.json
npm run apply:signals
```

Expected: 「既存企業・更新候補: 0件」「新規追加候補: 0件」「変更なし: 0件」が表示され、エラーなく終了する。確認後、フィクスチャを削除する(実データは別途Workflow実行後に生成するため):

```bash
rm data/signal-research-results.json
```

- [ ] **Step 5: コミット**

```bash
git add scripts/applySignals.ts package.json
git commit -m "feat: add applySignals script to reflect funding/job signal research results"
```

---

## 完了確認

- [ ] `npm run typecheck` が全体でエラーなく通る
- [ ] `npx playwright test` が全体でPASSする
- [ ] `docs/superpowers/specs/2026-08-04-funding-job-signal-priority-design.md`の各項目がいずれかのTaskで実装されていることを確認する

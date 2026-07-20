# スプレッドシート企業データ クリーニング Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** スプレッドシート上の企業データの表記ゆれ・不可視文字・重複行を安全に整理できるメンテナンススクリプトを作る。

**Architecture:** 一回限りのスクリプト`scripts/cleanupCompanyData.ts`が、既存の`sheetsClient.ts`/`sheetData.ts`を使って全行を取得し、純粋関数群(`textNormalize.ts`、`companyDuplicates.ts`)でテキスト正規化・重複グループ判定・統合可否の解決を行う。デフォルトはドライラン(レポート出力のみ)で、`--apply`を付けたときだけ実際にシートへ書き込み・行削除を行う。

**重要な補足(仕様書からの具体化):** 仕様書では「Fable 5による最終判定」をステップの一部として書いたが、Node製のスクリプト自体はClaude CodeのAgentツールを呼び出せない(Agentツールは会話環境側の機能であり、スタンドアロンスクリプトからは利用不可)。そのため実際の運用では、スクリプトが出力する「要目視確認」グループを見て、実行者(Claude Code)がAgentツール(`model: "fable"`)で個別に同一企業か判定し、その結果を`data/cleanup-decisions.json`に人力で保存する。スクリプトは次回のドライラン/apply実行時にこのファイルを読み込んで判定結果を反映する。つまり「Fable判定」はコードの外側で行う運用手順であり、本計画のタスクはその判定結果を受け取って安全に反映するコード(ドライラン→decisions.json読み込み→apply)を作ることに限定される。

**Tech Stack:** TypeScript, tsx, googleapis (Sheets API v4), @playwright/test(ユニットテストランナーとして流用)

## Global Constraints

- 対象列は企業名・企業URL・フォームURL・備考のみ。商談確定日・フォーム営業1〜3回目の日付列には一切触らない(仕様書のスコープ節より)
- デフォルト実行はドライラン。`--apply`フラグを明示しない限りシートへの書き込み・行削除は行わない
- 重複統合時に残す行は「商談確定日が入っている行 > フォーム営業の送信回数が多い行 > 元の行順で先頭」の優先順位で決定する
- コア名が一致する行が3つ以上あるグループは、完全一致しないペアが1組でも「同一企業でない」と判定されたら、グループ全体を自動統合せず要目視確認とする
- 既存のGoogle Sheets API呼び出しを伴う関数(`fetchSheetData`、`writeCells`等)と同様、新規のAPI呼び出し関数(`getSheetId`、`deleteRows`)は実アクセスを伴うためユニットテスト対象外とする

---

### Task 1: `normalizeCellText` の実装

**Files:**
- Create: `src/lib/textNormalize.ts`
- Test: `tests/textNormalize.test.ts`

**Interfaces:**
- Produces: `export function normalizeCellText(value: string): string`

- [ ] **Step 1: 失敗するテストを書く**

`tests/textNormalize.test.ts`を新規作成:

```ts
import { test, expect } from "@playwright/test";
import { normalizeCellText } from "../src/lib/textNormalize.js";

test("normalizeCellText: 前後の全角スペースをトリムする", () => {
  expect(normalizeCellText("　株式会社Example　")).toBe("株式会社Example");
});

test("normalizeCellText: ゼロ幅スペースを除去する", () => {
  expect(normalizeCellText("​株式会社ポリグロッツ")).toBe("株式会社ポリグロッツ");
});

test("normalizeCellText: BOM(U+FEFF)を除去する", () => {
  expect(normalizeCellText("﻿株式会社BOMテスト")).toBe("株式会社BOMテスト");
});

test("normalizeCellText: 半角/全角混在の末尾スペースをトリムする", () => {
  expect(normalizeCellText("エピソテック株式会社 　")).toBe("エピソテック株式会社");
});

test("normalizeCellText: 内部の連続する空白を1つの半角スペースに正規化する", () => {
  expect(normalizeCellText("foo   bar　　baz")).toBe("foo bar baz");
});

test("normalizeCellText: 変更不要な文字列はそのまま返す", () => {
  expect(normalizeCellText("通常のテキスト")).toBe("通常のテキスト");
});

test("normalizeCellText: 空文字列はそのまま返す", () => {
  expect(normalizeCellText("")).toBe("");
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx playwright test textNormalize.test.ts`
Expected: FAIL(`Cannot find module '../src/lib/textNormalize.js'`)

- [ ] **Step 3: 最小実装を書く**

`src/lib/textNormalize.ts`を新規作成:

```ts
const INVISIBLE_CHARS_REGEX = /[​‌‍﻿]/g;
const WHITESPACE_RUN_REGEX = /[ \t　]+/g;

/**
 * 企業名・URL・備考などのセル値から、前後の空白・全角スペース・
 * ゼロ幅スペースやBOMなどの不可視文字を除去し、内部の連続空白を
 * 半角スペース1つに正規化する。それ以外の文字は変更しない。
 */
export function normalizeCellText(value: string): string {
  return value
    .replace(INVISIBLE_CHARS_REGEX, "")
    .replace(WHITESPACE_RUN_REGEX, " ")
    .trim();
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx playwright test textNormalize.test.ts`
Expected: 7 tests PASS

- [ ] **Step 5: コミット**

```bash
git add src/lib/textNormalize.ts tests/textNormalize.test.ts
git commit -m "feat: add normalizeCellText for cleaning sheet cell whitespace/invisible chars"
```

---

### Task 2: `extractCompanyCoreName` の実装

**Files:**
- Modify: `src/lib/textNormalize.ts`
- Test: `tests/textNormalize.test.ts`

**Interfaces:**
- Consumes: なし(独立した純粋関数)
- Produces: `export function extractCompanyCoreName(name: string): string` — Task 4で`companyDuplicates.ts`から利用される

- [ ] **Step 1: 失敗するテストを書く**

`tests/textNormalize.test.ts`の末尾に追加:

```ts
import { extractCompanyCoreName } from "../src/lib/textNormalize.js";

test("extractCompanyCoreName: 前方の「株式会社」を除去する", () => {
  expect(extractCompanyCoreName("株式会社Luup")).toBe("luup");
});

test("extractCompanyCoreName: 後方の「株式会社」を除去する", () => {
  expect(extractCompanyCoreName("BlueWX株式会社")).toBe("bluewx");
});

test("extractCompanyCoreName: 法人格が付いていない社名はそのまま(小文字化のみ)", () => {
  expect(extractCompanyCoreName("Luup")).toBe("luup");
});

test("extractCompanyCoreName: 英語法人格(Inc./Ltd./Co., Ltd.)を除去する", () => {
  expect(extractCompanyCoreName("Example Inc.")).toBe("example");
  expect(extractCompanyCoreName("Example Ltd.")).toBe("example");
  expect(extractCompanyCoreName("Example Co., Ltd.")).toBe("example");
});

test("extractCompanyCoreName: ㈱を除去する", () => {
  expect(extractCompanyCoreName("㈱テスト")).toBe("テスト");
});

test("extractCompanyCoreName: 記号やスペースを除去する", () => {
  expect(extractCompanyCoreName("株式会社 Do＆Do.")).toBe("do＆do");
});
```

(既存importの`normalizeCellText`と同じ行に追加してよい: `import { normalizeCellText, extractCompanyCoreName } from "../src/lib/textNormalize.js";`)

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx playwright test textNormalize.test.ts -g "extractCompanyCoreName"`
Expected: FAIL(`extractCompanyCoreName is not a function` / `undefined`)

- [ ] **Step 3: 最小実装を書く**

`src/lib/textNormalize.ts`に追記:

```ts
const CORPORATE_SUFFIX_PATTERN =
  "株式会社|有限会社|合同会社|㈱|Co\\.,\\s?Ltd\\.?|K\\.K\\.|Corporation|Corp\\.|Inc\\.|Inc|Ltd\\.|Ltd";
const CORPORATE_SUFFIX_REGEX = new RegExp(CORPORATE_SUFFIX_PATTERN, "gi");
const NON_CORE_CHARS_REGEX = /[^a-z0-9぀-ヿ㐀-鿿]/gi;

/**
 * 企業名から法人格トークン(株式会社/Inc./Ltd.等、前後どちらの位置でも)と
 * 記号・スペースを除去し、小文字化した「コア名」を返す。
 * 表記ゆれ(法人格の有無・位置違い)による重複候補の突き合わせに使う。
 */
export function extractCompanyCoreName(name: string): string {
  const withoutSuffix = name.replace(CORPORATE_SUFFIX_REGEX, "");
  return withoutSuffix.replace(NON_CORE_CHARS_REGEX, "").toLowerCase();
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx playwright test textNormalize.test.ts`
Expected: 全テスト(13件)PASS

- [ ] **Step 5: コミット**

```bash
git add src/lib/textNormalize.ts tests/textNormalize.test.ts
git commit -m "feat: add extractCompanyCoreName for matching company-name variants"
```

---

### Task 3: `attemptProgress` をエクスポートする

**Files:**
- Modify: `src/lib/targetSelection.ts:82`

**Interfaces:**
- Produces: `export function attemptProgress(row: SheetRowData): number` — Task 4で`companyDuplicates.ts`から利用される

- [ ] **Step 1: 可視性を変更する**

`src/lib/targetSelection.ts:82`の

```ts
function attemptProgress(row: SheetRowData): number {
```

を

```ts
export function attemptProgress(row: SheetRowData): number {
```

に変更する。ロジックは変更しない。

- [ ] **Step 2: 既存テストが壊れていないことを確認する**

Run: `npx playwright test targetSelection.test.ts`
Expected: 既存の全テストPASS(挙動は変えていないため)

- [ ] **Step 3: コミット**

```bash
git add src/lib/targetSelection.ts
git commit -m "refactor: export attemptProgress for reuse in cleanup script"
```

---

### Task 4: 重複グループ抽出と優先行の決定(`groupByCoreName`/`choosePrimaryRow`)

**Files:**
- Create: `src/lib/companyDuplicates.ts`
- Test: `tests/companyDuplicates.test.ts`

**Interfaces:**
- Consumes: `extractCompanyCoreName(name: string): string`(Task 2)、`attemptProgress(row: SheetRowData): number`(Task 3)、`SheetRowData`(`src/types.js`)
- Produces:
  - `export interface DuplicateGroup { coreName: string; rows: SheetRowData[] }`
  - `export function groupByCoreName(rows: SheetRowData[]): DuplicateGroup[]`
  - `export function choosePrimaryRow(rows: SheetRowData[]): { primary: SheetRowData; discarded: SheetRowData[] }`
  - Task 5で同ファイルに追記される

- [ ] **Step 1: 失敗するテストを書く**

`tests/companyDuplicates.test.ts`を新規作成:

```ts
import { test, expect } from "@playwright/test";
import { groupByCoreName, choosePrimaryRow } from "../src/lib/companyDuplicates.js";
import type { SheetRowData } from "../src/types.js";

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
    ...overrides,
  };
}

test("groupByCoreName: コア名が一致する行をグループ化する", () => {
  const rows = [
    makeRow({ rowIndex: 2, companyName: "Luup" }),
    makeRow({ rowIndex: 3, companyName: "株式会社Luup" }),
    makeRow({ rowIndex: 4, companyName: "全く別の会社" }),
  ];

  const groups = groupByCoreName(rows);

  expect(groups).toHaveLength(1);
  expect(groups[0].coreName).toBe("luup");
  expect(groups[0].rows.map((r) => r.rowIndex)).toEqual([2, 3]);
});

test("groupByCoreName: 単独行(重複していない)はグループに含めない", () => {
  const rows = [makeRow({ rowIndex: 2, companyName: "ユニークな会社" })];

  expect(groupByCoreName(rows)).toHaveLength(0);
});

test("groupByCoreName: 企業名が空の行は無視する", () => {
  const rows = [
    makeRow({ rowIndex: 2, companyName: "" }),
    makeRow({ rowIndex: 3, companyName: "" }),
  ];

  expect(groupByCoreName(rows)).toHaveLength(0);
});

test("choosePrimaryRow: 商談確定日がある行を最優先で残す", () => {
  const rows = [
    makeRow({ rowIndex: 2, dealStatus: "", thirdSentAt: "2026/01/01" }),
    makeRow({ rowIndex: 3, dealStatus: "2026/07/21", firstSentAt: "2026/01/01" }),
  ];

  const { primary, discarded } = choosePrimaryRow(rows);

  expect(primary.rowIndex).toBe(3);
  expect(discarded.map((r) => r.rowIndex)).toEqual([2]);
});

test("choosePrimaryRow: 商談確定日が無ければ送信回数が多い行を残す", () => {
  const rows = [
    makeRow({ rowIndex: 2, firstSentAt: "2026/01/01" }),
    makeRow({ rowIndex: 3, firstSentAt: "2026/01/01", secondSentAt: "2026/02/01" }),
  ];

  const { primary, discarded } = choosePrimaryRow(rows);

  expect(primary.rowIndex).toBe(3);
  expect(discarded.map((r) => r.rowIndex)).toEqual([2]);
});

test("choosePrimaryRow: 優先度が同点なら元の行順で先頭を残す", () => {
  const rows = [
    makeRow({ rowIndex: 2 }),
    makeRow({ rowIndex: 3 }),
  ];

  const { primary, discarded } = choosePrimaryRow(rows);

  expect(primary.rowIndex).toBe(2);
  expect(discarded.map((r) => r.rowIndex)).toEqual([3]);
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx playwright test companyDuplicates.test.ts`
Expected: FAIL(`Cannot find module '../src/lib/companyDuplicates.js'`)

- [ ] **Step 3: 最小実装を書く**

`src/lib/companyDuplicates.ts`を新規作成:

```ts
import type { SheetRowData } from "../types.js";
import { attemptProgress } from "./targetSelection.js";
import { extractCompanyCoreName } from "./textNormalize.js";

export interface DuplicateGroup {
  coreName: string;
  rows: SheetRowData[];
}

/** 法人格の有無・位置違いなどの表記ゆれを吸収したコア名で行をグループ化する。単独行は含めない。 */
export function groupByCoreName(rows: SheetRowData[]): DuplicateGroup[] {
  const rowsByCoreName = new Map<string, SheetRowData[]>();
  for (const row of rows) {
    const coreName = extractCompanyCoreName(row.companyName);
    if (!coreName) continue;
    if (!rowsByCoreName.has(coreName)) rowsByCoreName.set(coreName, []);
    rowsByCoreName.get(coreName)!.push(row);
  }

  return [...rowsByCoreName.entries()]
    .filter(([, groupRows]) => groupRows.length > 1)
    .map(([coreName, groupRows]) => ({ coreName, rows: groupRows }));
}

function dealStatusRank(row: SheetRowData): number {
  return row.dealStatus.trim() !== "" ? 1 : 0;
}

/**
 * 重複行の中から残す1行を選ぶ。
 * 優先順位: 商談確定日がある行 > 送信回数(attemptProgress)が多い行 > 元の行順で先頭。
 */
export function choosePrimaryRow(
  rows: SheetRowData[],
): { primary: SheetRowData; discarded: SheetRowData[] } {
  let primary = rows[0];
  for (const row of rows.slice(1)) {
    const rowRank: [number, number] = [dealStatusRank(row), attemptProgress(row)];
    const primaryRank: [number, number] = [dealStatusRank(primary), attemptProgress(primary)];
    const isHigherPriority =
      rowRank[0] > primaryRank[0] || (rowRank[0] === primaryRank[0] && rowRank[1] > primaryRank[1]);
    if (isHigherPriority) primary = row;
  }
  return { primary, discarded: rows.filter((row) => row !== primary) };
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx playwright test companyDuplicates.test.ts`
Expected: 6 tests PASS

- [ ] **Step 5: コミット**

```bash
git add src/lib/companyDuplicates.ts tests/companyDuplicates.test.ts
git commit -m "feat: add groupByCoreName and choosePrimaryRow for duplicate detection"
```

---

### Task 5: Fable判定結果の解決ロジック(`resolveDuplicateGroups`)

**Files:**
- Modify: `src/lib/companyDuplicates.ts`
- Test: `tests/companyDuplicates.test.ts`

**Interfaces:**
- Consumes: `DuplicateGroup`、`choosePrimaryRow`(同ファイル、Task 4)
- Produces:
  - `export interface CleanupDecision { coreName: string; merge: boolean; notes?: string }`
  - `export interface ResolvedGroup { coreName: string; primary: SheetRowData; discarded: SheetRowData[] }`
  - `export interface UnresolvedGroup { coreName: string; rows: SheetRowData[]; reason: string }`
  - `export function pairsNeedingReview(rows: SheetRowData[]): [SheetRowData, SheetRowData][]`
  - `export function resolveDuplicateGroups(groups: DuplicateGroup[], decisions: CleanupDecision[]): { resolved: ResolvedGroup[]; unresolved: UnresolvedGroup[] }` — Task 7の`scripts/cleanupCompanyData.ts`から利用される

- [ ] **Step 1: 失敗するテストを書く**

`tests/companyDuplicates.test.ts`の末尾に追加(importに`resolveDuplicateGroups`と`pairsNeedingReview`を追記):

```ts
import {
  groupByCoreName,
  choosePrimaryRow,
  pairsNeedingReview,
  resolveDuplicateGroups,
} from "../src/lib/companyDuplicates.js";

test("pairsNeedingReview: 企業名が完全一致しない組み合わせのみ返す", () => {
  const rows = [
    makeRow({ rowIndex: 2, companyName: "Luup" }),
    makeRow({ rowIndex: 3, companyName: "Luup" }),
    makeRow({ rowIndex: 4, companyName: "株式会社Luup" }),
  ];

  const pairs = pairsNeedingReview(rows);

  expect(pairs).toHaveLength(2);
  expect(pairs.map(([a, b]) => [a.rowIndex, b.rowIndex])).toEqual([
    [2, 4],
    [3, 4],
  ]);
});

test("pairsNeedingReview: 全行が完全一致していれば空配列", () => {
  const rows = [
    makeRow({ rowIndex: 2, companyName: "Luup" }),
    makeRow({ rowIndex: 3, companyName: "luup" }),
  ];

  expect(pairsNeedingReview(rows)).toEqual([]);
});

test("resolveDuplicateGroups: 完全一致グループはFable判定なしで自動統合する", () => {
  const groups = [
    {
      coreName: "luup",
      rows: [makeRow({ rowIndex: 2, companyName: "Luup" }), makeRow({ rowIndex: 3, companyName: "Luup" })],
    },
  ];

  const { resolved, unresolved } = resolveDuplicateGroups(groups, []);

  expect(unresolved).toHaveLength(0);
  expect(resolved).toHaveLength(1);
  expect(resolved[0].primary.rowIndex).toBe(2);
  expect(resolved[0].discarded.map((r) => r.rowIndex)).toEqual([3]);
});

test("resolveDuplicateGroups: 表記ゆれがあり決定(merge:true)があれば統合する", () => {
  const groups = [
    {
      coreName: "luup",
      rows: [makeRow({ rowIndex: 2, companyName: "Luup" }), makeRow({ rowIndex: 3, companyName: "株式会社Luup" })],
    },
  ];

  const { resolved, unresolved } = resolveDuplicateGroups(groups, [
    { coreName: "luup", merge: true },
  ]);

  expect(unresolved).toHaveLength(0);
  expect(resolved).toHaveLength(1);
});

test("resolveDuplicateGroups: 表記ゆれがあり決定がまだ無ければ要目視確認にする", () => {
  const groups = [
    {
      coreName: "luup",
      rows: [makeRow({ rowIndex: 2, companyName: "Luup" }), makeRow({ rowIndex: 3, companyName: "株式会社Luup" })],
    },
  ];

  const { resolved, unresolved } = resolveDuplicateGroups(groups, []);

  expect(resolved).toHaveLength(0);
  expect(unresolved).toHaveLength(1);
  expect(unresolved[0].reason).toContain("未判定");
});

test("resolveDuplicateGroups: merge:falseの決定があれば要目視確認のまま(理由付き)", () => {
  const groups = [
    {
      coreName: "luup",
      rows: [makeRow({ rowIndex: 2, companyName: "Luup" }), makeRow({ rowIndex: 3, companyName: "株式会社Luup" })],
    },
  ];

  const { resolved, unresolved } = resolveDuplicateGroups(groups, [
    { coreName: "luup", merge: false, notes: "別会社と判定" },
  ]);

  expect(resolved).toHaveLength(0);
  expect(unresolved).toHaveLength(1);
  expect(unresolved[0].reason).toContain("別会社と判定");
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx playwright test companyDuplicates.test.ts -g "pairsNeedingReview|resolveDuplicateGroups"`
Expected: FAIL(`pairsNeedingReview is not a function` 等)

- [ ] **Step 3: 最小実装を書く**

`src/lib/companyDuplicates.ts`の末尾に追記:

```ts
export interface CleanupDecision {
  coreName: string;
  merge: boolean;
  notes?: string;
}

export interface ResolvedGroup {
  coreName: string;
  primary: SheetRowData;
  discarded: SheetRowData[];
}

export interface UnresolvedGroup {
  coreName: string;
  rows: SheetRowData[];
  reason: string;
}

function namesEqual(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** 企業名が完全一致しない(=Fableでの目視確認が必要な)組み合わせを全て返す。 */
export function pairsNeedingReview(rows: SheetRowData[]): [SheetRowData, SheetRowData][] {
  const pairs: [SheetRowData, SheetRowData][] = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (!namesEqual(rows[i].companyName, rows[j].companyName)) {
        pairs.push([rows[i], rows[j]]);
      }
    }
  }
  return pairs;
}

/**
 * 重複グループを「自動統合してよいもの」と「要目視確認のもの」に分ける。
 * - 企業名が完全一致するグループはFable判定なしで自動統合する
 * - 完全一致しないペアが1組でもあるグループは、`decisions`に
 *   `merge: true`の決定が無い限り統合せず要目視確認とする
 */
export function resolveDuplicateGroups(
  groups: DuplicateGroup[],
  decisions: CleanupDecision[],
): { resolved: ResolvedGroup[]; unresolved: UnresolvedGroup[] } {
  const decisionByCoreName = new Map(decisions.map((d) => [d.coreName, d]));
  const resolved: ResolvedGroup[] = [];
  const unresolved: UnresolvedGroup[] = [];

  for (const group of groups) {
    const reviewPairs = pairsNeedingReview(group.rows);
    if (reviewPairs.length === 0) {
      const { primary, discarded } = choosePrimaryRow(group.rows);
      resolved.push({ coreName: group.coreName, primary, discarded });
      continue;
    }

    const decision = decisionByCoreName.get(group.coreName);
    if (decision?.merge) {
      const { primary, discarded } = choosePrimaryRow(group.rows);
      resolved.push({ coreName: group.coreName, primary, discarded });
    } else {
      const reason = decision
        ? `Fableが同一企業ではないと判定しました${decision.notes ? `(${decision.notes})` : ""}`
        : "Fable未判定です。data/cleanup-decisions.json に判定結果を追加してください";
      unresolved.push({ coreName: group.coreName, rows: group.rows, reason });
    }
  }

  return { resolved, unresolved };
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx playwright test companyDuplicates.test.ts`
Expected: 全テスト(11件)PASS

- [ ] **Step 5: コミット**

```bash
git add src/lib/companyDuplicates.ts tests/companyDuplicates.test.ts
git commit -m "feat: add resolveDuplicateGroups to apply Fable review decisions"
```

---

### Task 6: Sheets APIへの行削除機能を追加(`getSheetId`/`deleteRows`)

**Files:**
- Modify: `src/lib/sheetsClient.ts`

**Interfaces:**
- Produces:
  - `export async function getSheetId(client: sheets_v4.Sheets, spreadsheetId: string, sheetName: string): Promise<number>`
  - `export async function deleteRows(client: sheets_v4.Sheets, spreadsheetId: string, sheetId: number, rowIndexes: number[]): Promise<void>`
  - Task 7の`scripts/cleanupCompanyData.ts`から利用される

このタスクは実際のGoogle Sheets APIアクセスを伴うため、既存の`createSheetsClient`等と同じ方針でユニットテスト対象外とする(型チェック`npx tsc --noEmit`のみ実施し、実際の動作確認はTask 8の手動ドライラン手順で行う)。

- [ ] **Step 1: 実装を書く**

`src/lib/sheetsClient.ts`の末尾(`writeCells`の後)に追記:

```ts
export async function getSheetId(
  client: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string,
): Promise<number> {
  const res = await client.spreadsheets.get({ spreadsheetId });
  const sheet = res.data.sheets?.find((s) => s.properties?.title === sheetName);
  const sheetId = sheet?.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) {
    throw new Error(`シートIDが取得できませんでした: ${sheetName}`);
  }
  return sheetId;
}

/** 指定した行番号(1始まり、ヘッダー行込み)を全て削除する。行番号が大きい順に削除し、インデックスのずれを防ぐ。 */
export async function deleteRows(
  client: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetId: number,
  rowIndexes: number[],
): Promise<void> {
  if (rowIndexes.length === 0) return;

  const sortedDescending = [...rowIndexes].sort((a, b) => b - a);
  const requests = sortedDescending.map((rowIndex) => ({
    deleteDimension: {
      range: {
        sheetId,
        dimension: "ROWS",
        startIndex: rowIndex - 1,
        endIndex: rowIndex,
      },
    },
  }));

  await client.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });
}
```

- [ ] **Step 2: 型チェックが通ることを確認する**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 3: コミット**

```bash
git add src/lib/sheetsClient.ts
git commit -m "feat: add getSheetId and deleteRows to sheetsClient"
```

---

### Task 7: メンテナンススクリプト本体(`scripts/cleanupCompanyData.ts`)

**Files:**
- Create: `scripts/cleanupCompanyData.ts`
- Modify: `package.json`(scriptsに追加)

**Interfaces:**
- Consumes:
  - `createSheetsClient`, `fetchSheetData`, `getFirstSheetName`, `getSheetId`, `writeCells`, `deleteRows`(`src/lib/sheetsClient.js`)
  - `parseSheetRows`(`src/lib/sheetData.js`)
  - `normalizeCellText`(`src/lib/textNormalize.js`)
  - `groupByCoreName`, `resolveDuplicateGroups`, `CleanupDecision`(`src/lib/companyDuplicates.js`)
  - `COLUMNS`, `SheetRowData`(`src/types.js`)

このタスクは実際のスプレッドシートに対して動作確認する必要があるため自動テストは書かない。Task 8で手動ドライラン手順を実施して動作確認する。

- [ ] **Step 1: スクリプトを実装する**

`scripts/cleanupCompanyData.ts`を新規作成:

```ts
import "dotenv/config";
import { readFile } from "node:fs/promises";
import {
  createSheetsClient,
  fetchSheetData,
  getFirstSheetName,
  getSheetId,
  writeCells,
  deleteRows,
} from "../src/lib/sheetsClient.js";
import { parseSheetRows } from "../src/lib/sheetData.js";
import { normalizeCellText } from "../src/lib/textNormalize.js";
import { groupByCoreName, resolveDuplicateGroups, type CleanupDecision } from "../src/lib/companyDuplicates.js";
import { COLUMNS, type SheetRowData } from "../src/types.js";

const DECISIONS_PATH = "data/cleanup-decisions.json";

const NORMALIZED_COLUMNS: { columnName: string; field: keyof SheetRowData }[] = [
  { columnName: COLUMNS.companyName, field: "companyName" },
  { columnName: COLUMNS.companyUrl, field: "companyUrl" },
  { columnName: COLUMNS.formUrl, field: "formUrl" },
  { columnName: COLUMNS.note, field: "note" },
];

interface NormalizationDiff {
  rowIndex: number;
  columnName: string;
  before: string;
  after: string;
}

function computeNormalizationDiffs(rows: SheetRowData[]): NormalizationDiff[] {
  const diffs: NormalizationDiff[] = [];
  for (const row of rows) {
    for (const { columnName, field } of NORMALIZED_COLUMNS) {
      const before = row[field] as string;
      const after = normalizeCellText(before);
      if (after !== before) {
        diffs.push({ rowIndex: row.rowIndex, columnName, before, after });
      }
    }
  }
  return diffs;
}

async function loadDecisions(): Promise<CleanupDecision[]> {
  try {
    const content = await readFile(DECISIONS_PATH, "utf-8");
    return JSON.parse(content) as CleanupDecision[];
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) {
    throw new Error("環境変数 GOOGLE_SHEET_ID が設定されていません");
  }

  const client = await createSheetsClient();
  const sheetName = await getFirstSheetName(client, spreadsheetId);
  const raw = await fetchSheetData(client, spreadsheetId, sheetName);
  const rows = parseSheetRows(raw);

  const diffs = computeNormalizationDiffs(rows);

  // 重複グループ判定は正規化後の企業名で行う(表記ゆれ吸収のため)
  const normalizedRows = rows.map((row) => ({ ...row, companyName: normalizeCellText(row.companyName) }));
  const groups = groupByCoreName(normalizedRows);
  const decisions = await loadDecisions();
  const { resolved, unresolved } = resolveDuplicateGroups(groups, decisions);

  console.log(`=== 正規化対象セル: ${diffs.length}件 ===`);
  for (const diff of diffs) {
    console.log(`  [行${diff.rowIndex}] ${diff.columnName}: "${diff.before}" -> "${diff.after}"`);
  }

  console.log(`\n=== 統合対象グループ: ${resolved.length}件 ===`);
  for (const group of resolved) {
    console.log(
      `  [${group.coreName}] 残す行=${group.primary.rowIndex}(${group.primary.companyName}) ` +
        `削除行=${group.discarded.map((r) => `${r.rowIndex}(${r.companyName})`).join(", ")}`,
    );
  }

  console.log(`\n=== 要目視確認グループ: ${unresolved.length}件 ===`);
  for (const group of unresolved) {
    console.log(
      `  [${group.coreName}] 行=${group.rows.map((r) => `${r.rowIndex}(${r.companyName})`).join(", ")}`,
    );
    console.log(`    理由: ${group.reason}`);
  }

  if (!apply) {
    console.log(
      "\n(ドライランのため、実際の書き込み・削除は行っていません。内容を確認して --apply を付けて再実行してください)",
    );
    return;
  }

  if (diffs.length > 0) {
    try {
      await writeCells(
        client,
        spreadsheetId,
        sheetName,
        diffs.map((diff) => ({ rowIndex: diff.rowIndex, columnName: diff.columnName, value: diff.after })),
        raw.headerRow,
      );
      console.log(`\n正規化${diffs.length}件を書き込みました。`);
    } catch (error) {
      console.error(`\n正規化の書き込みに失敗しました(行削除は未実施です): ${String(error)}`);
      throw error;
    }
  }

  const discardedRowIndexes = resolved.flatMap((group) => group.discarded.map((row) => row.rowIndex));
  if (discardedRowIndexes.length > 0) {
    try {
      const sheetId = await getSheetId(client, spreadsheetId, sheetName);
      await deleteRows(client, spreadsheetId, sheetId, discardedRowIndexes);
      console.log(`削除${discardedRowIndexes.length}行を反映しました。`);
    } catch (error) {
      console.error(
        `\n行削除に失敗しました(正規化の書き込みは完了済みです。削除予定行: ${discardedRowIndexes.join(", ")}): ${String(error)}`,
      );
      throw error;
    }
  }

  console.log(`\n反映しました: 正規化${diffs.length}件、削除${discardedRowIndexes.length}行`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: `package.json`にスクリプトを追加する**

`package.json`の`scripts`に以下を追加:

```json
"cleanup:company-names": "tsx scripts/cleanupCompanyData.ts"
```

(`"cleanup:company-names --apply"`のように引数を付ける場合は `npm run cleanup:company-names -- --apply` の形で実行する)

- [ ] **Step 3: 型チェックが通ることを確認する**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 4: コミット**

```bash
git add scripts/cleanupCompanyData.ts package.json
git commit -m "feat: add cleanupCompanyData script (dry-run by default)"
```

---

### Task 8: README・運用手順のドキュメント化

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README に運用手順を追記する**

READMEの末尾に以下のセクションを追加する(既存の見出しレベルに合わせる):

```markdown
## スプレッドシートの企業データクリーニング

企業名の表記ゆれ・不可視文字・重複行を整理するメンテナンススクリプト。

1. ドライラン実行してレポートを確認する:
   ```bash
   npm run cleanup:company-names
   ```
2. 出力の「要目視確認グループ」を確認し、それぞれ同一企業かどうかをFable 5などで判定する
3. 判定結果を `data/cleanup-decisions.json` に追記する(ファイルが無ければ新規作成):
   ```json
   [
     { "coreName": "luup", "merge": true },
     { "coreName": "arch", "merge": false, "notes": "別会社と判定" }
   ]
   ```
   `coreName` はドライラン出力の `[coreName]` 部分をそのまま使う。
4. 再度ドライラン実行して、想定通り統合対象グループに移っていることを確認する
5. 問題なければ実際に反映する:
   ```bash
   npm run cleanup:company-names -- --apply
   ```

商談確定日・フォーム営業1〜3回目の日付列は対象外。統合時は「商談確定日がある行 > 送信回数が多い行 > 元の行順で先頭」の行を残し、他方は行ごと削除する。
```

- [ ] **Step 2: コミット**

```bash
git add README.md
git commit -m "docs: document company-name cleanup script usage"
```

---

## 実装後の実行手順(コードではなく運用)

1. `npm run cleanup:company-names` でドライラン実行し、正規化差分・自動統合グループ・要目視確認グループを確認する
2. 要目視確認グループそれぞれについて、Agentツール(`model: "fable"`)に2社の企業名(・URL)を渡し `{ sameCompany, confidence, reason }` を判定させる
3. `confidence: "high"` かつ `sameCompany: true` の場合のみ `data/cleanup-decisions.json` に `{ coreName, merge: true }` を追加する。それ以外は `merge: false` として理由を `notes` に残す
4. `npm run cleanup:company-names` を再実行し、レポート内容が意図通りか確認する
5. 問題なければ `npm run cleanup:company-names -- --apply` で実際に反映する

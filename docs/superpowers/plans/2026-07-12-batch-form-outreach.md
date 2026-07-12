# フォーム送信ワークフロー高速化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Googleスプレッドシートをマスターにした「一括タブオープン→人手送信→自動結果記録」のバッチ実行CLIを作り、月17時間かかっているフォーム営業を6時間程度に短縮する。

**Architecture:** 既存のPlaywright+CommanderベースのCLIを土台に、CSV(`data/targets.csv`/`data/results.csv`)を廃止してGoogle Sheets APIを読み書き先にする。対象選定・シート行パース・結果判定・書き込み内容の組み立ては全て純粋関数として実装しユニットテストする。ブラウザ操作(フォームURL探索・自動入力・送信結果判定)はPlaywrightの`page`を使った実HTMLフィクスチャでテストする。CLI本体(`src/index.ts`)は上記モジュールを配線するだけの薄い統合層とし、最後に実シートに対する手動確認で仕上げる。

**Tech Stack:** TypeScript(Node.js, ESM) / Playwright / `@playwright/test` / `googleapis`(サービスアカウント認証) / Commander / dotenv

## Global Constraints

- 対象シートID: `1-dYD-yUelDgn9PmOQvg-B_7RdcS4cuNRq9ARwJLm2ZU` (`.env`の`GOOGLE_SHEET_ID`で設定、コードにハードコードしない)
- 既存シートの列名(日本語・スペース含む)は変更しない。新規列は「フォームURL」の1列のみ追加する
- フォロー送信間隔は30日
- 備考のスキップキーワードは以下の6つに限定する(これ以外を推測で追加しない): `フォーム無`, `Google Formで不可`, `電話のみ`, `サポートのみ`, `リンク切れ`, `メール`
- 「商談 確定日」列が`あり`の行は対象から除外する
- 既存の1件ずつ処理モード(`--submit`含む)、`src/lib/targets.ts`、`src/lib/results.ts`、`data/targets.csv`、`data/results.csv`は廃止する
- 日付はシート上の表記`YYYY/MM/DD`で読み書きする
- サービスアカウントの認証情報ファイルはリポジトリにコミットしない

---

## 事前準備(コード外・人が行う作業)

実装前に以下をユーザー自身が行っておく必要がある(コーディングタスクではないため計画外だが、Task 5以降の動作確認に必須):

1. Google Cloudプロジェクトを作成し、Google Sheets APIを有効化する
2. サービスアカウントを作成し、JSON形式のキーをダウンロードする
3. 対象スプレッドシート(`1-dYD-yUelDgn9PmOQvg-B_7RdcS4cuNRq9ARwJLm2ZU`)を、サービスアカウントのメールアドレスに「編集者」権限で共有する
4. ダウンロードしたJSONキーをリポジトリ直下の`credentials/google-service-account.json`に置く(このパスは`.gitignore`済みにする、Task 1で対応)
5. シートに「フォームURL」列を1列追加する(ヘッダー行に追記するだけでよい)

---

### Task 1: テスト基盤の追加と `.gitignore` 更新

**Files:**
- Modify: `package.json`
- Create: `playwright.config.ts`
- Create: `tests/smoke.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `npm test` コマンド(`playwright test`を実行)

- [ ] **Step 1: 依存関係を追加する**

```bash
npm install googleapis dotenv
npm install -D @playwright/test
```

- [ ] **Step 2: `playwright.config.ts` を作成する**

```typescript
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 10_000,
  fullyParallel: true,
});
```

- [ ] **Step 3: スモークテストを書く(意図的に失敗させる)**

```typescript
// tests/smoke.test.ts
import { test, expect } from "@playwright/test";

test("2 + 2 は 4 になる(セットアップ確認用)", () => {
  expect(2 + 2).toBe(5);
});
```

- [ ] **Step 4: 失敗することを確認する**

Run: `npx playwright test`
Expected: FAIL (`expect(received).toBe(expected)` で `4 !== 5`)

- [ ] **Step 5: テストを正しい値に直して通す**

```typescript
// tests/smoke.test.ts
import { test, expect } from "@playwright/test";

test("2 + 2 は 4 になる(セットアップ確認用)", () => {
  expect(2 + 2).toBe(4);
});
```

Run: `npx playwright test`
Expected: PASS (1 passed)

- [ ] **Step 6: `package.json` に `test` スクリプトを追加する**

`package.json` の `scripts` に追記:

```json
"test": "playwright test"
```

- [ ] **Step 7: `.gitignore` にサービスアカウントキーの除外を追加する**

`.gitignore` に追記:

```
credentials/
test-results/
playwright-report/
```

- [ ] **Step 8: コミット**

```bash
git add package.json package-lock.json playwright.config.ts tests/smoke.test.ts .gitignore
git commit -m "test: add @playwright/test harness and googleapis/dotenv deps"
```

---

### Task 2: 型定義とシート列名定数の追加

**Files:**
- Modify: `src/types.ts`

**Interfaces:**
- Produces:
  - `export const COLUMNS` — シート列名の文字列定数マップ
  - `export interface SheetRowData` — シート1行分のパース済みデータ
  - `export type AttemptNumber = 1 | 2 | 3`
  - `export interface EligibleTarget { row: SheetRowData; attemptNumber: AttemptNumber }`
  - 既存の `Template` interfaceはそのまま維持
  - 既存の `TargetStatus` / `Target` / `SubmissionResult` は削除する(CSV運用の残骸のため)

このタスクは型定義のみで実行可能なテストがないため、Task 3のテストが通ることでこのタスクの正しさも検証される。型定義とTask 3を1コミットにまとめる。

- [ ] **Step 1: `src/types.ts` を書き換える**

```typescript
// src/types.ts
export interface Template {
  name: string;
  senderCompany: string;
  senderName: string;
  senderEmail: string;
  senderPhone: string;
  subject: string;
  message: string;
}

export const COLUMNS = {
  companyName: "企業名",
  companyUrl: "企業URL",
  formUrl: "フォームURL",
  note: "備考",
  dealStatus: "商談 確定日",
  firstSent: "フォーム営業 1回目",
  secondSent: "フォーム営業 2回目",
  thirdSent: "フォーム営業 3回目",
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
}

export type AttemptNumber = 1 | 2 | 3;

export interface EligibleTarget {
  row: SheetRowData;
  attemptNumber: AttemptNumber;
}
```

(このステップだけではテストを実行しない。Task 3の完了時にまとめてコミットする。)

---

### Task 3: 対象選定ロジック(`targetSelection.ts`)

**Files:**
- Create: `src/lib/targetSelection.ts`
- Test: `tests/targetSelection.test.ts`

**Interfaces:**
- Consumes: `SheetRowData`, `AttemptNumber`, `EligibleTarget`, `COLUMNS`(`../src/types.ts`)
- Produces:
  - `export function parseSheetDate(value: string | null): Date | null`
  - `export function formatSheetDate(date: Date): string`
  - `export function isSkipped(row: SheetRowData): boolean`
  - `export function getNextAttempt(row: SheetRowData, today: Date): AttemptNumber | null`
  - `export function selectBatch(rows: SheetRowData[], batchSize: number, today: Date): EligibleTarget[]`

- [ ] **Step 1: 失敗するテストを書く**

```typescript
// tests/targetSelection.test.ts
import { test, expect } from "@playwright/test";
import {
  parseSheetDate,
  formatSheetDate,
  isSkipped,
  getNextAttempt,
  selectBatch,
} from "../src/lib/targetSelection.js";
import type { SheetRowData } from "../src/types.js";

function makeRow(overrides: Partial<SheetRowData>): SheetRowData {
  return {
    rowIndex: 2,
    companyName: "サンプル株式会社",
    companyUrl: "https://example.com/",
    formUrl: "",
    note: "",
    dealStatus: "無",
    firstSentAt: null,
    secondSentAt: null,
    thirdSentAt: null,
    ...overrides,
  };
}

test("parseSheetDate は YYYY/MM/DD をDateに変換する", () => {
  const date = parseSheetDate("2023/11/09");
  expect(date?.getFullYear()).toBe(2023);
  expect(date?.getMonth()).toBe(10);
  expect(date?.getDate()).toBe(9);
});

test("parseSheetDate は空文字/nullでnullを返す", () => {
  expect(parseSheetDate(null)).toBeNull();
  expect(parseSheetDate("")).toBeNull();
});

test("formatSheetDate は YYYY/MM/DD 形式の文字列を返す", () => {
  expect(formatSheetDate(new Date(2026, 6, 12))).toBe("2026/07/12");
});

test("isSkipped は備考にスキップキーワードが含まれていればtrue", () => {
  expect(isSkipped(makeRow({ note: "フォーム無" }))).toBe(true);
  expect(isSkipped(makeRow({ note: "Google Formで不可" }))).toBe(true);
  expect(isSkipped(makeRow({ note: "期間短い" }))).toBe(false);
  expect(isSkipped(makeRow({ note: "" }))).toBe(false);
});

test("getNextAttempt: 1回目が空欄なら1を返す", () => {
  const today = new Date(2026, 6, 12);
  expect(getNextAttempt(makeRow({}), today)).toBe(1);
});

test("getNextAttempt: 商談ありなら対象外", () => {
  const today = new Date(2026, 6, 12);
  expect(getNextAttempt(makeRow({ dealStatus: "あり" }), today)).toBeNull();
});

test("getNextAttempt: スキップキーワードがあれば対象外", () => {
  const today = new Date(2026, 6, 12);
  expect(getNextAttempt(makeRow({ note: "フォーム無" }), today)).toBeNull();
});

test("getNextAttempt: 3回目済みなら対象外", () => {
  const today = new Date(2026, 6, 12);
  const row = makeRow({
    firstSentAt: "2026/01/01",
    secondSentAt: "2026/02/01",
    thirdSentAt: "2026/03/01",
  });
  expect(getNextAttempt(row, today)).toBeNull();
});

test("getNextAttempt: 1回目から30日未満なら2回目は対象外", () => {
  const row = makeRow({ firstSentAt: "2026/06/20" });
  const today = new Date(2026, 6, 12); // 22日後...ではなく20日後未満のケースを作る
  const notYet = new Date(2026, 6, 15); // 2026/06/20 -> 2026/07/15 は25日後
  expect(getNextAttempt(row, notYet)).toBeNull();
});

test("getNextAttempt: 1回目から30日以上経過していれば2回目が対象", () => {
  const row = makeRow({ firstSentAt: "2026/06/01" });
  const today = new Date(2026, 6, 1); // 2026/07/01、30日後
  expect(getNextAttempt(row, today)).toBe(2);
});

test("getNextAttempt: 2回目から30日以上経過していれば3回目が対象", () => {
  const row = makeRow({
    firstSentAt: "2026/05/01",
    secondSentAt: "2026/06/01",
  });
  const today = new Date(2026, 6, 1); // 2回目から30日後
  expect(getNextAttempt(row, today)).toBe(3);
});

test("selectBatch: 対象行を先頭からbatchSize件だけ返す", () => {
  const rows = [
    makeRow({ rowIndex: 2, companyName: "A" }),
    makeRow({ rowIndex: 3, companyName: "B", note: "フォーム無" }),
    makeRow({ rowIndex: 4, companyName: "C" }),
    makeRow({ rowIndex: 5, companyName: "D" }),
  ];
  const today = new Date(2026, 6, 12);
  const batch = selectBatch(rows, 2, today);
  expect(batch.map((t) => t.row.companyName)).toEqual(["A", "C"]);
  expect(batch.every((t) => t.attemptNumber === 1)).toBe(true);
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx playwright test tests/targetSelection.test.ts`
Expected: FAIL(`../src/lib/targetSelection.js` が存在しないためモジュール解決エラー)

- [ ] **Step 3: 実装する**

```typescript
// src/lib/targetSelection.ts
import type { AttemptNumber, EligibleTarget, SheetRowData } from "../types.js";

const SKIP_MARKERS = [
  "フォーム無",
  "Google Formで不可",
  "電話のみ",
  "サポートのみ",
  "リンク切れ",
  "メール",
];

const FOLLOW_UP_INTERVAL_DAYS = 30;

export function parseSheetDate(value: string | null): Date | null {
  if (!value) return null;
  const parts = value.split("/").map(Number);
  const [year, month, day] = parts;
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

export function formatSheetDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

function daysBetween(from: Date, to: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor((to.getTime() - from.getTime()) / msPerDay);
}

export function isSkipped(row: SheetRowData): boolean {
  return SKIP_MARKERS.some((marker) => row.note.includes(marker));
}

export function getNextAttempt(row: SheetRowData, today: Date): AttemptNumber | null {
  if (row.dealStatus === "あり") return null;
  if (isSkipped(row)) return null;

  if (!row.firstSentAt) return 1;
  if (row.thirdSentAt) return null;

  if (!row.secondSentAt) {
    const first = parseSheetDate(row.firstSentAt);
    if (!first) return null;
    return daysBetween(first, today) >= FOLLOW_UP_INTERVAL_DAYS ? 2 : null;
  }

  const second = parseSheetDate(row.secondSentAt);
  if (!second) return null;
  return daysBetween(second, today) >= FOLLOW_UP_INTERVAL_DAYS ? 3 : null;
}

export function selectBatch(
  rows: SheetRowData[],
  batchSize: number,
  today: Date,
): EligibleTarget[] {
  const result: EligibleTarget[] = [];
  for (const row of rows) {
    if (result.length >= batchSize) break;
    const attemptNumber = getNextAttempt(row, today);
    if (attemptNumber !== null) {
      result.push({ row, attemptNumber });
    }
  }
  return result;
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx playwright test tests/targetSelection.test.ts`
Expected: PASS(全件)

- [ ] **Step 5: コミット**

```bash
git add src/types.ts src/lib/targetSelection.ts tests/targetSelection.test.ts
git commit -m "feat: add target selection logic based on sheet follow-up columns"
```

---

### Task 4: シート行パース・列変換・備考追記ヘルパー(`sheetData.ts`)

**Files:**
- Create: `src/lib/sheetData.ts`
- Test: `tests/sheetData.test.ts`

**Interfaces:**
- Consumes: `SheetRowData`, `COLUMNS`(`../src/types.ts`)
- Produces:
  - `export interface RawSheetData { headerRow: string[]; dataRows: string[][] }`
  - `export function parseSheetRows(raw: RawSheetData): SheetRowData[]`
  - `export function columnIndexToLetter(index: number): string`
  - `export function appendNote(existing: string, addition: string): string`

- [ ] **Step 1: 失敗するテストを書く**

```typescript
// tests/sheetData.test.ts
import { test, expect } from "@playwright/test";
import { parseSheetRows, columnIndexToLetter, appendNote } from "../src/lib/sheetData.js";
import { COLUMNS } from "../src/types.js";

test("columnIndexToLetter: 0はA, 25はZ, 26はAA", () => {
  expect(columnIndexToLetter(0)).toBe("A");
  expect(columnIndexToLetter(25)).toBe("Z");
  expect(columnIndexToLetter(26)).toBe("AA");
});

test("appendNote: 既存が空なら追加文字列だけになる", () => {
  expect(appendNote("", "要確認")).toBe("要確認");
});

test("appendNote: 既存があれば ' / ' で連結する", () => {
  expect(appendNote("メール", "要確認")).toBe("メール / 要確認");
});

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
  ];
  const dataRows = [
    ["サンプル株式会社", "https://example.com/", "", "フォーム無", "無", "", "", ""],
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
    },
  ]);
});

test("parseSheetRows: 列名が見つからない場合はエラーを投げる", () => {
  expect(() => parseSheetRows({ headerRow: ["何か"], dataRows: [] })).toThrow(
    /企業名/,
  );
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx playwright test tests/sheetData.test.ts`
Expected: FAIL(モジュール未解決)

- [ ] **Step 3: 実装する**

```typescript
// src/lib/sheetData.ts
import { COLUMNS, type SheetRowData } from "../types.js";

export interface RawSheetData {
  headerRow: string[];
  dataRows: string[][];
}

export function columnIndexToLetter(index: number): string {
  let letter = "";
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

export function appendNote(existing: string, addition: string): string {
  const trimmed = existing.trim();
  return trimmed ? `${trimmed} / ${addition}` : addition;
}

function findColumnIndex(headerRow: string[], columnName: string): number {
  const index = headerRow.indexOf(columnName);
  if (index === -1) {
    throw new Error(`列が見つかりません: ${columnName}`);
  }
  return index;
}

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
  }));
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx playwright test tests/sheetData.test.ts`
Expected: PASS(全件)

- [ ] **Step 5: コミット**

```bash
git add src/lib/sheetData.ts tests/sheetData.test.ts
git commit -m "feat: add sheet row parsing and column helper functions"
```

---

### Task 5: Google Sheets APIクライアント(`sheetsClient.ts`)

**Files:**
- Create: `src/lib/sheetsClient.ts`
- Create: `.env.example`

**Interfaces:**
- Consumes: `RawSheetData`(`./sheetData.js`)
- Produces:
  - `export async function createSheetsClient(): Promise<sheets_v4.Sheets>`
  - `export async function getFirstSheetName(client: sheets_v4.Sheets, spreadsheetId: string): Promise<string>`
  - `export async function fetchSheetData(client: sheets_v4.Sheets, spreadsheetId: string, sheetName: string): Promise<RawSheetData>`
  - `export async function writeCells(client: sheets_v4.Sheets, spreadsheetId: string, sheetName: string, writes: { rowIndex: number; columnName: string; value: string }[], headerRow: string[]): Promise<void>`

このタスクはGoogle APIへの実通信を伴うため自動テストは書かない(Task 13で実シートに対して手動確認する)。関数は薄く保ち、ロジック部分(列名→セル位置変換など)は既にTask 4でテスト済みのものを再利用する。

- [ ] **Step 1: `.env.example` を作成する**

```
GOOGLE_SERVICE_ACCOUNT_KEY_PATH=credentials/google-service-account.json
GOOGLE_SHEET_ID=1-dYD-yUelDgn9PmOQvg-B_7RdcS4cuNRq9ARwJLm2ZU
```

- [ ] **Step 2: 実装する**

```typescript
// src/lib/sheetsClient.ts
import { google, type sheets_v4 } from "googleapis";
import { columnIndexToLetter } from "./sheetData.js";
import type { RawSheetData } from "./sheetData.js";

export async function createSheetsClient(): Promise<sheets_v4.Sheets> {
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  if (!keyFile) {
    throw new Error("環境変数 GOOGLE_SERVICE_ACCOUNT_KEY_PATH が設定されていません");
  }
  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

export async function getFirstSheetName(
  client: sheets_v4.Sheets,
  spreadsheetId: string,
): Promise<string> {
  const res = await client.spreadsheets.get({ spreadsheetId });
  const title = res.data.sheets?.[0]?.properties?.title;
  if (!title) {
    throw new Error("スプレッドシートのシート名が取得できませんでした");
  }
  return title;
}

export async function fetchSheetData(
  client: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string,
): Promise<RawSheetData> {
  const res = await client.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A1:Z`,
  });
  const values = res.data.values ?? [];
  const [headerRow = [], ...dataRows] = values;
  return { headerRow, dataRows };
}

export async function writeCells(
  client: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string,
  writes: { rowIndex: number; columnName: string; value: string }[],
  headerRow: string[],
): Promise<void> {
  const data = writes.map((write) => {
    const colIndex = headerRow.indexOf(write.columnName);
    if (colIndex === -1) {
      throw new Error(`列が見つかりません: ${write.columnName}`);
    }
    const colLetter = columnIndexToLetter(colIndex);
    return {
      range: `${sheetName}!${colLetter}${write.rowIndex}`,
      values: [[write.value]],
    };
  });

  if (data.length === 0) return;

  await client.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data,
    },
  });
}
```

- [ ] **Step 3: 型チェックが通ることを確認する**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: エラーなし

- [ ] **Step 4: コミット**

```bash
git add src/lib/sheetsClient.ts .env.example
git commit -m "feat: add Google Sheets API client wrapper"
```

---

### Task 6: お問い合わせフォームURLの自動探索(`formDiscovery.ts`)

**Files:**
- Create: `src/lib/formDiscovery.ts`
- Test: `tests/formDiscovery.test.ts`

**Interfaces:**
- Produces: `export async function findContactFormUrl(page: Page): Promise<string | null>`
  (呼び出し側が先に `page.goto(companyUrl)` していること前提。見つかった場合はブラウザが解決した絶対URLを返す)

- [ ] **Step 1: 失敗するテストを書く**

```typescript
// tests/formDiscovery.test.ts
import { test, expect } from "@playwright/test";
import { findContactFormUrl } from "../src/lib/formDiscovery.js";

test("お問い合わせリンクが見つかればフルURLを返す", async ({ page }) => {
  await page.route("https://example.test/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<html><body>
        <a href="/about">会社概要</a>
        <a href="/contact">お問い合わせ</a>
      </body></html>`,
    }),
  );
  await page.goto("https://example.test/");

  const result = await findContactFormUrl(page);
  expect(result).toBe("https://example.test/contact");
});

test("英語の contact リンクも検出する", async ({ page }) => {
  await page.route("https://example.test/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<html><body><a href="/contact-us">Contact</a></body></html>`,
    }),
  );
  await page.goto("https://example.test/");

  const result = await findContactFormUrl(page);
  expect(result).toBe("https://example.test/contact-us");
});

test("該当リンクがなければnullを返す", async ({ page }) => {
  await page.route("https://example.test/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<html><body><a href="/about">会社概要</a></body></html>`,
    }),
  );
  await page.goto("https://example.test/");

  const result = await findContactFormUrl(page);
  expect(result).toBeNull();
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx playwright test tests/formDiscovery.test.ts`
Expected: FAIL(モジュール未解決)

- [ ] **Step 3: 実装する**

```typescript
// src/lib/formDiscovery.ts
import type { Page } from "playwright";

const CONTACT_LINK_KEYWORDS = ["お問い合わせ", "お問合せ", "contact", "inquiry"];

export async function findContactFormUrl(page: Page): Promise<string | null> {
  const links = page.locator("a");
  const count = await links.count();

  for (let i = 0; i < count; i++) {
    const link = links.nth(i);
    const text = await link.innerText().catch(() => "");
    const href = await link
      .evaluate((el) => (el as HTMLAnchorElement).href)
      .catch(() => "");

    if (!href) continue;

    const haystack = `${text} ${href}`.toLowerCase();
    if (CONTACT_LINK_KEYWORDS.some((keyword) => haystack.includes(keyword.toLowerCase()))) {
      return href;
    }
  }

  return null;
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx playwright test tests/formDiscovery.test.ts`
Expected: PASS(全件)

- [ ] **Step 5: コミット**

```bash
git add src/lib/formDiscovery.ts tests/formDiscovery.test.ts
git commit -m "feat: auto-discover contact form URL from company homepage"
```

---

### Task 7: 自動入力バナーの表示(`formSubmitter.ts` 拡張)

**Files:**
- Modify: `src/lib/formSubmitter.ts`
- Test: `tests/formSubmitter.test.ts`

**Interfaces:**
- Consumes: 既存の `fillForm`, `FillResult`(`./formSubmitter.js`)
- Produces: `export async function injectFillBanner(page: Page, filledFields: string[], missingFields: string[]): Promise<void>`

- [ ] **Step 1: 失敗するテストを書く**

```typescript
// tests/formSubmitter.test.ts
import { test, expect } from "@playwright/test";
import { injectFillBanner } from "../src/lib/formSubmitter.js";

test("injectFillBanner: 入力済み/未検出のフィールドを表示するバナーを挿入する", async ({ page }) => {
  await page.setContent("<html><body><h1>Contact</h1></body></html>");

  await injectFillBanner(page, ["senderCompany", "senderName"], ["senderPhone"]);

  const bannerText = await page.locator("[data-auto-form-banner]").innerText();
  expect(bannerText).toContain("会社名○");
  expect(bannerText).toContain("氏名○");
  expect(bannerText).toContain("電話✗");
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx playwright test tests/formSubmitter.test.ts`
Expected: FAIL(`injectFillBanner` が存在しない)

- [ ] **Step 3: 実装する**

`src/lib/formSubmitter.ts` の末尾に追記する:

```typescript
const FIELD_LABELS: Record<string, string> = {
  senderCompany: "会社名",
  senderName: "氏名",
  senderEmail: "メール",
  senderPhone: "電話",
  subject: "件名",
  message: "本文",
};

export async function injectFillBanner(
  page: Page,
  filledFields: string[],
  missingFields: string[],
): Promise<void> {
  const summary = [
    ...filledFields.map((field) => `${FIELD_LABELS[field] ?? field}○`),
    ...missingFields.map((field) => `${FIELD_LABELS[field] ?? field}✗`),
  ].join(" ");

  await page.evaluate((text) => {
    const banner = document.createElement("div");
    banner.textContent = `自動入力: ${text}`;
    banner.setAttribute("data-auto-form-banner", "true");
    Object.assign(banner.style, {
      position: "fixed",
      top: "0",
      left: "0",
      zIndex: "999999",
      background: "#222",
      color: "#fff",
      padding: "6px 12px",
      fontSize: "12px",
      fontFamily: "sans-serif",
    });
    document.body.prepend(banner);
  }, summary);
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx playwright test tests/formSubmitter.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/lib/formSubmitter.ts tests/formSubmitter.test.ts
git commit -m "feat: show auto-fill status banner on each opened form tab"
```

---

### Task 8: 送信結果の判定(`completionCheck.ts`)

**Files:**
- Create: `src/lib/completionCheck.ts`
- Test: `tests/completionCheck.test.ts`

**Interfaces:**
- Produces: `export async function checkSubmissionOutcome(page: Page, originalUrl: string): Promise<"success" | "uncertain">`

- [ ] **Step 1: 失敗するテストを書く**

```typescript
// tests/completionCheck.test.ts
import { test, expect } from "@playwright/test";
import { checkSubmissionOutcome } from "../src/lib/completionCheck.js";

test("URLが変わっていればsuccess", async ({ page }) => {
  await page.route("https://example.test/contact", (route) =>
    route.fulfill({ contentType: "text/html", body: "<html><body>form</body></html>" }),
  );
  await page.route("https://example.test/thanks", (route) =>
    route.fulfill({ contentType: "text/html", body: "<html><body>done</body></html>" }),
  );
  await page.goto("https://example.test/contact");
  await page.goto("https://example.test/thanks");

  const result = await checkSubmissionOutcome(page, "https://example.test/contact");
  expect(result).toBe("success");
});

test("URLは同じでも完了文言があればsuccess", async ({ page }) => {
  await page.route("https://example.test/contact", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<html><body>送信が完了しました。ありがとうございました。</body></html>",
    }),
  );
  await page.goto("https://example.test/contact");

  const result = await checkSubmissionOutcome(page, "https://example.test/contact");
  expect(result).toBe("success");
});

test("URLも同じで完了文言もなければuncertain", async ({ page }) => {
  await page.route("https://example.test/contact", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<html><body><form><input name='name'></form></body></html>",
    }),
  );
  await page.goto("https://example.test/contact");

  const result = await checkSubmissionOutcome(page, "https://example.test/contact");
  expect(result).toBe("uncertain");
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx playwright test tests/completionCheck.test.ts`
Expected: FAIL(モジュール未解決)

- [ ] **Step 3: 実装する**

```typescript
// src/lib/completionCheck.ts
import type { Page } from "playwright";

const SUCCESS_KEYWORDS = [
  "ありがとうございました",
  "送信が完了",
  "受け付けました",
  "thank you",
];

export async function checkSubmissionOutcome(
  page: Page,
  originalUrl: string,
): Promise<"success" | "uncertain"> {
  if (page.url() !== originalUrl) {
    return "success";
  }

  const bodyText = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
  const matched = SUCCESS_KEYWORDS.some((keyword) => bodyText.includes(keyword.toLowerCase()));
  return matched ? "success" : "uncertain";
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx playwright test tests/completionCheck.test.ts`
Expected: PASS(全件)

- [ ] **Step 5: コミット**

```bash
git add src/lib/completionCheck.ts tests/completionCheck.test.ts
git commit -m "feat: detect submission outcome from URL change or success keywords"
```

---

### Task 9: 結果書き込み内容の組み立て(`updates.ts`)

**Files:**
- Create: `src/lib/updates.ts`
- Test: `tests/updates.test.ts`

**Interfaces:**
- Consumes: `AttemptNumber`, `COLUMNS`(`../types.js`), `appendNote`(`./sheetData.js`), `formatSheetDate`(`./targetSelection.js`)
- Produces:
  - `export interface OutcomeUpdate { rowIndex: number; attemptNumber: AttemptNumber; outcome: "success" | "uncertain" | "failed"; existingNote: string; formUrl?: string; failureReason?: string }`
  - `export interface CellWrite { rowIndex: number; columnName: string; value: string }`
  - `export function buildUpdates(update: OutcomeUpdate, today: Date): CellWrite[]`

- [ ] **Step 1: 失敗するテストを書く**

```typescript
// tests/updates.test.ts
import { test, expect } from "@playwright/test";
import { buildUpdates } from "../src/lib/updates.js";
import { COLUMNS } from "../src/types.js";

const today = new Date(2026, 6, 12);

test("success: 該当のフォーム営業N回目列に日付を書く", () => {
  const writes = buildUpdates(
    { rowIndex: 5, attemptNumber: 1, outcome: "success", existingNote: "" },
    today,
  );
  expect(writes).toEqual([
    { rowIndex: 5, columnName: COLUMNS.firstSent, value: "2026/07/12" },
  ]);
});

test("success: フォームURLを新規発見していればフォームURL列も書く", () => {
  const writes = buildUpdates(
    {
      rowIndex: 5,
      attemptNumber: 2,
      outcome: "success",
      existingNote: "",
      formUrl: "https://example.com/contact",
    },
    today,
  );
  expect(writes).toEqual(
    expect.arrayContaining([
      { rowIndex: 5, columnName: COLUMNS.secondSent, value: "2026/07/12" },
      { rowIndex: 5, columnName: COLUMNS.formUrl, value: "https://example.com/contact" },
    ]),
  );
});

test("uncertain: 日付を書きつつ備考に「要確認」を追記する", () => {
  const writes = buildUpdates(
    { rowIndex: 5, attemptNumber: 3, outcome: "uncertain", existingNote: "メール" },
    today,
  );
  expect(writes).toEqual(
    expect.arrayContaining([
      { rowIndex: 5, columnName: COLUMNS.thirdSent, value: "2026/07/12" },
      { rowIndex: 5, columnName: COLUMNS.note, value: "メール / 要確認" },
    ]),
  );
});

test("failed: フォーム営業N回目列には書かず備考に理由を追記する", () => {
  const writes = buildUpdates(
    {
      rowIndex: 5,
      attemptNumber: 1,
      outcome: "failed",
      existingNote: "",
      failureReason: "ページ到達不可",
    },
    today,
  );
  expect(writes).toEqual([
    { rowIndex: 5, columnName: COLUMNS.note, value: "ページ到達不可" },
  ]);
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx playwright test tests/updates.test.ts`
Expected: FAIL(モジュール未解決)

- [ ] **Step 3: 実装する**

```typescript
// src/lib/updates.ts
import { COLUMNS, type AttemptNumber } from "../types.js";
import { appendNote } from "./sheetData.js";
import { formatSheetDate } from "./targetSelection.js";

export interface OutcomeUpdate {
  rowIndex: number;
  attemptNumber: AttemptNumber;
  outcome: "success" | "uncertain" | "failed";
  existingNote: string;
  formUrl?: string;
  failureReason?: string;
}

export interface CellWrite {
  rowIndex: number;
  columnName: string;
  value: string;
}

const ATTEMPT_COLUMN: Record<AttemptNumber, string> = {
  1: COLUMNS.firstSent,
  2: COLUMNS.secondSent,
  3: COLUMNS.thirdSent,
};

export function buildUpdates(update: OutcomeUpdate, today: Date): CellWrite[] {
  const writes: CellWrite[] = [];

  if (update.outcome === "success" || update.outcome === "uncertain") {
    writes.push({
      rowIndex: update.rowIndex,
      columnName: ATTEMPT_COLUMN[update.attemptNumber],
      value: formatSheetDate(today),
    });
  }

  if (update.formUrl) {
    writes.push({
      rowIndex: update.rowIndex,
      columnName: COLUMNS.formUrl,
      value: update.formUrl,
    });
  }

  if (update.outcome === "uncertain") {
    writes.push({
      rowIndex: update.rowIndex,
      columnName: COLUMNS.note,
      value: appendNote(update.existingNote, "要確認"),
    });
  } else if (update.outcome === "failed" && update.failureReason) {
    writes.push({
      rowIndex: update.rowIndex,
      columnName: COLUMNS.note,
      value: appendNote(update.existingNote, update.failureReason),
    });
  }

  return writes;
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx playwright test tests/updates.test.ts`
Expected: PASS(全件)

- [ ] **Step 5: コミット**

```bash
git add src/lib/updates.ts tests/updates.test.ts
git commit -m "feat: build sheet cell writes from submission outcomes"
```

---

### Task 10: 書き込み失敗時のローカルバックアップ(`pendingWrites.ts`)

**Files:**
- Create: `src/lib/pendingWrites.ts`
- Test: `tests/pendingWrites.test.ts`

**Interfaces:**
- Consumes: `CellWrite`(`./updates.js`)
- Produces:
  - `export async function savePendingWrites(dir: string, writes: CellWrite[]): Promise<string>`
  - `export async function loadPendingWrites(dir: string): Promise<{ path: string; writes: CellWrite[] }[]>`
  - `export async function deletePendingWrite(path: string): Promise<void>`

Google Sheets APIへの書き込みが失敗した場合に結果を取りこぼさないため、ローカルにJSONとして保存し、次回起動時に再送できるようにする。

- [ ] **Step 1: 失敗するテストを書く**

```typescript
// tests/pendingWrites.test.ts
import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  savePendingWrites,
  loadPendingWrites,
  deletePendingWrite,
} from "../src/lib/pendingWrites.js";

test("savePendingWrites/loadPendingWrites: 保存した内容を読み戻せる", async () => {
  const dir = await mkdtemp(join(tmpdir(), "auto-form-pending-"));
  try {
    const writes = [{ rowIndex: 3, columnName: "備考", value: "テスト" }];
    const path = await savePendingWrites(dir, writes);

    const loaded = await loadPendingWrites(dir);
    expect(loaded).toEqual([{ path, writes }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("deletePendingWrite: 削除後は読み込まれない", async () => {
  const dir = await mkdtemp(join(tmpdir(), "auto-form-pending-"));
  try {
    const writes = [{ rowIndex: 1, columnName: "備考", value: "x" }];
    const path = await savePendingWrites(dir, writes);
    await deletePendingWrite(path);

    const loaded = await loadPendingWrites(dir);
    expect(loaded).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx playwright test tests/pendingWrites.test.ts`
Expected: FAIL(モジュール未解決)

- [ ] **Step 3: 実装する**

```typescript
// src/lib/pendingWrites.ts
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CellWrite } from "./updates.js";

export async function savePendingWrites(dir: string, writes: CellWrite[]): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, `pending-${Date.now()}.json`);
  await writeFile(path, JSON.stringify(writes, null, 2), "utf-8");
  return path;
}

export async function loadPendingWrites(
  dir: string,
): Promise<{ path: string; writes: CellWrite[] }[]> {
  await mkdir(dir, { recursive: true });
  const files = (await readdir(dir)).filter((file) => file.endsWith(".json"));
  const results: { path: string; writes: CellWrite[] }[] = [];
  for (const file of files) {
    const path = join(dir, file);
    const content = await readFile(path, "utf-8");
    results.push({ path, writes: JSON.parse(content) as CellWrite[] });
  }
  return results;
}

export async function deletePendingWrite(path: string): Promise<void> {
  await rm(path, { force: true });
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx playwright test tests/pendingWrites.test.ts`
Expected: PASS(全件)

- [ ] **Step 5: コミット**

```bash
git add src/lib/pendingWrites.ts tests/pendingWrites.test.ts
git commit -m "feat: back up sheet writes locally when the Sheets API call fails"
```

---

### Task 11: CLIオーケストレーション(`src/index.ts` 書き換え)

**Files:**
- Modify: `src/index.ts`
- Delete: `src/lib/targets.ts`
- Delete: `src/lib/results.ts`

**Interfaces:**
- Consumes: すべての既存モジュール(`targetSelection.js`, `sheetData.js`, `sheetsClient.js`, `formDiscovery.js`, `formSubmitter.js`, `completionCheck.js`, `updates.js`, `pendingWrites.js`, `templates.js`)
- Produces: CLIエントリーポイント。自動テストなし(Task 13で手動確認)。

- [ ] **Step 1: 不要になった旧モジュールを削除する**

```bash
rm src/lib/targets.ts src/lib/results.ts
```

- [ ] **Step 2: `src/index.ts` を書き換える**

```typescript
// src/index.ts
import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { Command } from "commander";
import { chromium, type Page } from "playwright";
import { loadTemplate } from "./lib/templates.js";
import { fillForm, injectFillBanner } from "./lib/formSubmitter.js";
import { findContactFormUrl } from "./lib/formDiscovery.js";
import { checkSubmissionOutcome } from "./lib/completionCheck.js";
import { selectBatch } from "./lib/targetSelection.js";
import { parseSheetRows } from "./lib/sheetData.js";
import {
  createSheetsClient,
  fetchSheetData,
  getFirstSheetName,
  writeCells,
} from "./lib/sheetsClient.js";
import { buildUpdates, type OutcomeUpdate } from "./lib/updates.js";
import {
  savePendingWrites,
  loadPendingWrites,
  deletePendingWrite,
} from "./lib/pendingWrites.js";
import type { EligibleTarget } from "./types.js";

const PENDING_WRITES_DIR = "data/pending-writes";

const program = new Command();

program
  .name("auto-form")
  .description("お問い合わせフォームへの自動営業ツール(Googleスプレッドシート連携版)")
  .option("-m, --template <path>", "文面テンプレートJSON", "data/templates/default.json")
  .option("-b, --batch-size <n>", "1回のバッチで開くタブ数", "20")
  .action(async (opts) => {
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    if (!spreadsheetId) {
      throw new Error("環境変数 GOOGLE_SHEET_ID が設定されていません");
    }

    const template = await loadTemplate(opts.template);
    const sheetsClient = await createSheetsClient();
    const sheetName = await getFirstSheetName(sheetsClient, spreadsheetId);

    const pending = await loadPendingWrites(PENDING_WRITES_DIR);
    if (pending.length > 0) {
      console.log(`前回書き込めなかった結果が${pending.length}件あります。再送します...`);
      for (const entry of pending) {
        try {
          const raw = await fetchSheetData(sheetsClient, spreadsheetId, sheetName);
          await writeCells(sheetsClient, spreadsheetId, sheetName, entry.writes, raw.headerRow);
          await deletePendingWrite(entry.path);
        } catch (error) {
          console.warn(`再送に失敗しました(${entry.path}): ${String(error)}`);
        }
      }
    }

    const raw = await fetchSheetData(sheetsClient, spreadsheetId, sheetName);
    const rows = parseSheetRows(raw);

    const batch = selectBatch(rows, Number(opts.batchSize), new Date());
    if (batch.length === 0) {
      console.log("送信対象の企業がありません。");
      return;
    }

    console.log(`${batch.length}件のタブを開きます...`);

    const browser = await chromium.launch({ headless: false });
    const opened: { target: EligibleTarget; page: Page; formUrl: string; discoveredUrl?: string }[] = [];

    for (const target of batch) {
      const page = await browser.newPage();
      let formUrl = target.row.formUrl;

      try {
        if (formUrl) {
          await page.goto(formUrl, { waitUntil: "domcontentloaded" });
        } else {
          await page.goto(target.row.companyUrl, { waitUntil: "domcontentloaded" });
          const discovered = await findContactFormUrl(page);
          if (!discovered) {
            console.warn(`[${target.row.companyName}] お問い合わせフォームが見つかりませんでした`);
            await page.close();
            continue;
          }
          await page.goto(discovered, { waitUntil: "domcontentloaded" });
          formUrl = discovered;
        }

        const { filledFields, missingFields } = await fillForm(page, template);
        await injectFillBanner(page, filledFields, missingFields);
        opened.push({ target, page, formUrl, discoveredUrl: target.row.formUrl ? undefined : formUrl });
      } catch (error) {
        console.warn(`[${target.row.companyName}] 読み込みに失敗: ${String(error)}`);
        await page.close();
      }
    }

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    await rl.question(
      `\n${opened.length}件のタブを開きました。確認・送信が終わったらEnterキーを押してください...`,
    );
    rl.close();

    const outcomeUpdates: OutcomeUpdate[] = [];
    for (const entry of opened) {
      const outcome = await checkSubmissionOutcome(entry.page, entry.formUrl);
      outcomeUpdates.push({
        rowIndex: entry.target.row.rowIndex,
        attemptNumber: entry.target.attemptNumber,
        outcome,
        existingNote: entry.target.row.note,
        formUrl: entry.discoveredUrl,
      });
      await entry.page.close();
    }

    await browser.close();

    const writes = outcomeUpdates.flatMap((update) => buildUpdates(update, new Date()));
    try {
      await writeCells(sheetsClient, spreadsheetId, sheetName, writes, raw.headerRow);
      console.log(`結果をスプレッドシートに記録しました(${outcomeUpdates.length}件)。`);
    } catch (error) {
      const path = await savePendingWrites(PENDING_WRITES_DIR, writes);
      console.warn(
        `スプレッドシートへの書き込みに失敗しました: ${String(error)}\n` +
          `結果は ${path} に保存しました。次回起動時に自動で再送されます。`,
      );
    }
  });

program.parseAsync();
```

- [ ] **Step 3: 型チェックを実行する**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: エラーなし

- [ ] **Step 4: 既存の全ユニットテストが引き続き通ることを確認する**

Run: `npx playwright test`
Expected: PASS(全件)

- [ ] **Step 5: コミット**

```bash
git add -A src/
git commit -m "feat: rewrite CLI as sheet-driven batch runner, remove CSV-based single mode"
```

---

### Task 12: ドキュメント・不要ファイルの整理

**Files:**
- Modify: `README.md`
- Delete: `data/targets.csv`
- Delete: `data/results.csv`(存在する場合)
- Modify: `.gitignore`

- [ ] **Step 1: 不要なCSVを削除する**

```bash
rm -f data/targets.csv data/results.csv
```

- [ ] **Step 2: `.gitignore` から不要なCSV関連の記述を整理する**

`data/results/*.csv` の行を削除する(結果はもうCSVに出力しないため)。

- [ ] **Step 3: `README.md` を書き換える**

```markdown
# auto-form

お問い合わせフォームへの自動営業ツール。Googleスプレッドシートをマスターに、
対象企業のフォームを一括で開いて自動入力し、人が確認・送信した結果をスプレッドシートへ自動で記録する。

## 構成

- Googleスプレッドシート — 対象企業リスト・フォーム営業履歴・備考・商談状況のマスター
- `data/templates/*.json` — 営業文面テンプレート(会社名・氏名・連絡先・件名・本文)
- `src/lib/targetSelection.ts` — スプレッドシートの内容から「今送るべき対象」を選ぶロジック
- `src/lib/formDiscovery.ts` — 企業のトップページからお問い合わせフォームのURLを自動探索
- `src/lib/formSubmitter.ts` — フォーム項目をラベル/name/placeholderのキーワードから推測して入力し、入力状況をバナー表示
- `src/lib/completionCheck.ts` — 送信後のページ状態から成功/要確認を判定
- `src/lib/sheetsClient.ts` — Google Sheets APIとの読み書き
- `src/index.ts` — CLIエントリーポイント(バッチ実行)

## セットアップ

```bash
npm install
npm run playwright:install
```

1. Google Cloudでサービスアカウントを作成し、Google Sheets APIを有効化する
2. 対象スプレッドシートをサービスアカウントのメールアドレスに編集者権限で共有する
3. サービスアカウントのJSONキーを `credentials/google-service-account.json` に置く
4. `.env.example` を `.env` にコピーし、`GOOGLE_SERVICE_ACCOUNT_KEY_PATH` と `GOOGLE_SHEET_ID` を設定する
5. スプレッドシートのヘッダー行に「フォームURL」列を追加する

## 使い方

```bash
# 既定20件のバッチを開く
npm run dev

# バッチサイズを指定する
npm run dev -- --batch-size 10
```

タブが開いたら、各タブを順番に確認し、キャプチャ対応・送信ボタンのクリックを人手で行う。
すべて終わったらターミナルでEnterキーを押すと、各タブの送信結果を判定してスプレッドシートに記録する。

## 注意事項

- フォーム構造はサイトごとに異なるため、フィールドの自動検出・送信結果の判定には限界がある。判定できない場合は備考に「要確認」と記録されるので、あとで見直すこと。
- 送信ボタンのクリックや「私はロボットではありません」等の対応は自動化せず、必ず人が行う。
- 送信先サイトの利用規約やスクレイピング/自動送信に関するポリシーを事前に確認すること。
- 過度な連続アクセスは相手サーバーに負荷をかけるため、バッチサイズや実行間隔に配慮すること。
```

- [ ] **Step 4: コミット**

```bash
git add -A README.md .gitignore
git commit -m "docs: update README for sheet-driven batch workflow, remove obsolete CSVs"
```

---

### Task 13: 実シートに対する手動動作確認

自動テストではカバーしていない、実際のGoogle Sheets API連携・実サイトへのアクセスを確認する。コードの変更は行わない。

- [ ] **Step 1: バッチサイズを小さくして試す**

```bash
npm run dev -- --batch-size 2
```

- [ ] **Step 2: 開いたタブでフォームURLの自動探索と自動入力が行われていることを目視確認する**

各タブ左上に自動入力バナーが表示され、フォーム項目が妥当に入力されていることを確認する。

- [ ] **Step 3: 1件は実際に送信し、1件は送信せずページ内に留まる状態でEnterキーを押す**

送信した方が「フォーム営業N回目」列に本日の日付で記録され、送信していない方が備考に「要確認」付きで記録されることを確認する。

- [ ] **Step 4: スプレッドシート側で書き込み結果を目視確認する**

対象行の「フォーム営業N回目」列・「フォームURL」列・「備考」列が期待通り更新されていることを確認する。

- [ ] **Step 5: 問題があれば該当タスクに戻って修正し、再度このタスクを実行する**

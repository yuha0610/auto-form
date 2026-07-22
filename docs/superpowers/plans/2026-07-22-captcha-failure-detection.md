# CAPTCHA検証失敗の自動検知 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 確認・送信後の結果チェック(`checkSubmissionOutcome`)でCAPTCHA検証失敗の文言を自動検知し、既存の`"failed"` + `failureReason`の仕組みで備考欄に「CAPTCHA」を書き込む(既存の`SKIP_MARKERS`により次回以降自動スキップされる)。

**Architecture:** `checkSubmissionOutcome`の戻り値を`"success" | "uncertain"`という文字列から`{ outcome: "success" | "uncertain" | "failed"; failureReason?: string }`というオブジェクトに拡張する。本文に「captcha」という語と失敗を示す語の両方が含まれていれば`{ outcome: "failed", failureReason: "CAPTCHA" }`を返す。`buildUpdates`(`src/lib/updates.ts`)は既に任意の`failureReason`文字列を備考欄に書き込む処理を持っているため、この部分の変更は不要。呼び出し元の`src/index.ts`のみ、新しい戻り値の形に合わせて修正する。

**Tech Stack:** TypeScript, Playwright (`@playwright/test`によるテスト)

## Global Constraints

- `checkSubmissionOutcome`のcatch経路(送信結果の確認自体に失敗した場合)は`outcome: "uncertain"`のまま変更しない(`src/index.ts`)
- CAPTCHA以外の失敗理由の自動検知は対象外(仕様書スコープ外)
- キーワードリストの継続的な自動拡張の仕組み化は対象外。今回のキーワードセットのみを実装する

---

### Task 1: `completionCheck.ts` にCAPTCHA検知ロジックを追加し、戻り値をオブジェクト化する

**Files:**
- Modify: `src/lib/completionCheck.ts`
- Test: `tests/completionCheck.test.ts`

**Interfaces:**
- Produces: `export interface SubmissionOutcome { outcome: "success" | "uncertain" | "failed"; failureReason?: string }` と `export async function checkSubmissionOutcome(page: Page, originalUrl: string): Promise<SubmissionOutcome>`(戻り値の型が変わる破壊的変更。Task 2で呼び出し元を追従させる)

- [ ] **Step 1: 既存テストを新しい戻り値の形に書き換え、CAPTCHA検知のテストを追加する**

`tests/completionCheck.test.ts` を以下の内容で置き換える(既存3ケースの`expect`を`toEqual({ outcome: ... })`に変更し、新規3ケースを追加):

```ts
import { test, expect } from "@playwright/test";
import { checkSubmissionOutcome } from "../src/lib/completionCheck.js";

test("URLが変わっていればsuccess", async ({ page }) => {
  await page.route("https://example.test/contact", (route) =>
    route.fulfill({ contentType: "text/html; charset=utf-8", body: "<html><head><meta charset='utf-8'></head><body>form</body></html>" }),
  );
  await page.route("https://example.test/thanks", (route) =>
    route.fulfill({ contentType: "text/html; charset=utf-8", body: "<html><head><meta charset='utf-8'></head><body>done</body></html>" }),
  );
  await page.goto("https://example.test/contact");
  await page.goto("https://example.test/thanks");

  const result = await checkSubmissionOutcome(page, "https://example.test/contact");
  expect(result).toEqual({ outcome: "success" });
});

test("URLは同じでも完了文言があればsuccess", async ({ page }) => {
  await page.route("https://example.test/contact", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: "<html><head><meta charset='utf-8'></head><body>送信が完了しました。ありがとうございました。</body></html>",
    }),
  );
  await page.goto("https://example.test/contact");

  const result = await checkSubmissionOutcome(page, "https://example.test/contact");
  expect(result).toEqual({ outcome: "success" });
});

test("URLも同じで完了文言もなければuncertain", async ({ page }) => {
  await page.route("https://example.test/contact", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: "<html><head><meta charset='utf-8'></head><body><form><input name='name'></form></body></html>",
    }),
  );
  await page.goto("https://example.test/contact");

  const result = await checkSubmissionOutcome(page, "https://example.test/contact");
  expect(result).toEqual({ outcome: "uncertain" });
});

test("CAPTCHAの検証に失敗しましたと表示されていればfailed(CAPTCHA)", async ({ page }) => {
  await page.route("https://example.test/contact", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: "<html><head><meta charset='utf-8'></head><body>CAPTCHAの検証に失敗しました</body></html>",
    }),
  );
  await page.goto("https://example.test/contact");

  const result = await checkSubmissionOutcome(page, "https://example.test/contact");
  expect(result).toEqual({ outcome: "failed", failureReason: "CAPTCHA" });
});

test("英語のreCAPTCHAエラー表示でもfailed(CAPTCHA)", async ({ page }) => {
  await page.route("https://example.test/contact", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: "<html><head><meta charset='utf-8'></head><body>reCAPTCHA verification error, please try again</body></html>",
    }),
  );
  await page.goto("https://example.test/contact");

  const result = await checkSubmissionOutcome(page, "https://example.test/contact");
  expect(result).toEqual({ outcome: "failed", failureReason: "CAPTCHA" });
});

test("captchaという語を含まない認証エラーは誤検知しない", async ({ page }) => {
  await page.route("https://example.test/contact", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: "<html><head><meta charset='utf-8'></head><body>認証に失敗しました</body></html>",
    }),
  );
  await page.goto("https://example.test/contact");

  const result = await checkSubmissionOutcome(page, "https://example.test/contact");
  expect(result).toEqual({ outcome: "uncertain" });
});
```

- [ ] **Step 2: テストを実行して失敗することを確認する**

Run: `npx playwright test tests/completionCheck.test.ts`
Expected: FAIL(既存3ケースは戻り値が文字列のままなので`toEqual({ outcome: ... })`と一致せず失敗、新規3ケースは`isCaptchaFailure`が存在せず失敗)

- [ ] **Step 3: `src/lib/completionCheck.ts` を実装する**

ファイル全体を以下の内容で置き換える:

```ts
import type { Page } from "playwright";

const SUCCESS_KEYWORDS = [
  "ありがとうございました",
  "送信が完了",
  "受け付けました",
  "thank you",
];

const CAPTCHA_FAILURE_TERMS = ["失敗", "エラー", "できません", "failed", "error", "invalid"];

function isCaptchaFailure(bodyText: string): boolean {
  return bodyText.includes("captcha") && CAPTCHA_FAILURE_TERMS.some((term) => bodyText.includes(term));
}

export interface SubmissionOutcome {
  outcome: "success" | "uncertain" | "failed";
  failureReason?: string;
}

export async function checkSubmissionOutcome(
  page: Page,
  originalUrl: string,
): Promise<SubmissionOutcome> {
  if (page.url() !== originalUrl) {
    return { outcome: "success" };
  }

  const bodyText = (await page.locator("body").innerText().catch(() => "")).toLowerCase();

  if (isCaptchaFailure(bodyText)) {
    return { outcome: "failed", failureReason: "CAPTCHA" };
  }

  const matched = SUCCESS_KEYWORDS.some((keyword) => bodyText.includes(keyword.toLowerCase()));
  return matched ? { outcome: "success" } : { outcome: "uncertain" };
}
```

- [ ] **Step 4: テストを実行してすべて成功することを確認する**

Run: `npx playwright test tests/completionCheck.test.ts`
Expected: PASS(6件すべて)

- [ ] **Step 5: コミット**

```bash
git add src/lib/completionCheck.ts tests/completionCheck.test.ts
git commit -m "feat: detect CAPTCHA verification failure in submission outcome check"
```

---

### Task 2: `updates.ts`(`buildUpdates`)がCAPTCHAの`failureReason`も既存経路で処理することを確認するテストを追加する

**Files:**
- Test: `tests/updates.test.ts`

**Interfaces:**
- Consumes: `buildUpdates`(Task 1で変更なし。`src/lib/updates.ts`は既に`outcome: "failed"` + 任意の`failureReason`文字列を備考欄へ書き込む処理を持つ)

- [ ] **Step 1: CAPTCHA用のテストケースを追加する**

`tests/updates.test.ts` の末尾(`email`のテストの後)に以下を追加する:

```ts
test("failed: failureReasonがCAPTCHAの場合も同じ経路で備考へ追記する", () => {
  const writes = buildUpdates(
    {
      rowIndex: 5,
      attemptNumber: 1,
      outcome: "failed",
      existingNote: "",
      failureReason: "CAPTCHA",
    },
    today,
  );
  expect(writes).toEqual([
    { rowIndex: 5, columnName: COLUMNS.note, value: "CAPTCHA" },
  ]);
});
```

- [ ] **Step 2: テストを実行して成功することを確認する**

Run: `npx playwright test tests/updates.test.ts`
Expected: PASS(既存ケース含めすべて。`src/lib/updates.ts`はこのタスクで変更しないため、既存実装のまま通る想定)

- [ ] **Step 3: コミット**

```bash
git add tests/updates.test.ts
git commit -m "test: cover CAPTCHA failureReason in buildUpdates"
```

---

### Task 3: `src/index.ts` の呼び出し箇所を新しい戻り値の形に追従させる

**Files:**
- Modify: `src/index.ts:191-215`

**Interfaces:**
- Consumes: Task 1で定義した `checkSubmissionOutcome(page, originalUrl): Promise<{ outcome: "success" | "uncertain" | "failed"; failureReason?: string }>`

- [ ] **Step 1: 呼び出し箇所を修正する**

`src/index.ts` の以下の箇所:

```ts
      for (const entry of opened) {
        try {
          const outcome = await checkSubmissionOutcome(entry.page, entry.formUrl);
          outcomeUpdates.push({
            rowIndex: entry.target.row.rowIndex,
            attemptNumber: entry.target.attemptNumber,
            outcome,
            existingNote: entry.target.row.note,
            formUrl: entry.discoveredUrl,
          });
          expectedCompanyName.set(entry.target.row.rowIndex, entry.target.row.companyName);
        } catch (error) {
```

を以下に置き換える:

```ts
      for (const entry of opened) {
        try {
          const { outcome, failureReason } = await checkSubmissionOutcome(entry.page, entry.formUrl);
          outcomeUpdates.push({
            rowIndex: entry.target.row.rowIndex,
            attemptNumber: entry.target.attemptNumber,
            outcome,
            existingNote: entry.target.row.note,
            formUrl: entry.discoveredUrl,
            failureReason,
          });
          expectedCompanyName.set(entry.target.row.rowIndex, entry.target.row.companyName);
        } catch (error) {
```

catchブロック内(`outcome: "uncertain"`を直接pushしている箇所)は変更しない。

- [ ] **Step 2: 型チェックを実行して通ることを確認する**

Run: `npm run typecheck`
Expected: エラーなし終了(`checkSubmissionOutcome`の戻り値の分割代入、`OutcomeUpdate.failureReason`への代入がいずれも型に合致する)

- [ ] **Step 3: 全テストを実行してリグレッションがないことを確認する**

Run: `npx playwright test`
Expected: PASS(全ファイル)

- [ ] **Step 4: コミット**

```bash
git add src/index.ts
git commit -m "feat: propagate CAPTCHA failure reason from completion check to sheet update"
```

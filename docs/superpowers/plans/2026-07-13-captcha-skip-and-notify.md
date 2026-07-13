# CAPTCHA事前スキップ & 確認待ち通知 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 過去にCAPTCHAが出たとわかっている企業を次回バッチから自動除外できるようにし、タブを開き終えて確認・送信待ちになったタイミングをmacOS通知で知らせる。

**Architecture:** 既存の `SKIP_MARKERS` 方式(備考欄の文字列マッチ)にマーカーを1つ追加するだけで機能1を実現する。機能2は新規の小さな `src/lib/notify.ts` モジュールを追加し、`src/index.ts` のバッチ実行フローに1呼び出しを追加する。

**Tech Stack:** TypeScript (NodeNext ESM, `.js`拡張子でのimport), `node:child_process` の `execFile`, テストは `@playwright/test` の `test`/`expect`(ユニットテストとしても利用)。

## Global Constraints

- reCAPTCHA/CAPTCHAの自動検知・自動突破は行わない(スコープ外)
- `notifyBatchReady` は macOS(`process.platform === "darwin"`)以外では no-op とする
- 通知失敗はバッチ処理全体を止めない(例外を投げず `console.warn` のみ)
- 通知文言・サウンドはハードコードで固定(設定化しない)

---

### Task 1: CAPTCHA事前スキップマーカー追加

**Files:**
- Modify: `src/lib/targetSelection.ts:3-10` (`SKIP_MARKERS` 配列)
- Modify: `README.md` (使い方セクションに追記)
- Test: `tests/targetSelection.test.ts`

**Interfaces:**
- Consumes: なし(既存の `isSkipped(row: SheetRowData): boolean` のロジックをそのまま利用)
- Produces: なし(内部データの追加のみ、公開シグネチャの変更なし)

- [ ] **Step 1: 失敗するテストを書く**

`tests/targetSelection.test.ts` の `isSkipped` のテストの直後(46行目、`test("isSkipped は備考にスキップキーワードが含まれていればtrue"...)` の直後)に以下を追加する:

```ts
test("isSkipped: 備考にCAPTCHAが含まれていればtrue", () => {
  expect(isSkipped(makeRow({ note: "CAPTCHAあり" }))).toBe(true);
  expect(isSkipped(makeRow({ note: "CAPTCHA" }))).toBe(true);
});
```

**Run:** `npx playwright test tests/targetSelection.test.ts -g "CAPTCHA"`
**Expected:** FAIL(`CAPTCHAあり`/`CAPTCHA` が `SKIP_MARKERS` に無いため `isSkipped` が `false` を返す)

- [ ] **Step 2: `SKIP_MARKERS` に `"CAPTCHA"` を追加する**

`src/lib/targetSelection.ts` の該当箇所を以下に変更する:

```ts
const SKIP_MARKERS = [
  "フォーム無",
  "Google Formで不可",
  "電話のみ",
  "サポートのみ",
  "リンク切れ",
  "メール",
  "CAPTCHA",
];
```

- [ ] **Step 3: テストを実行してパスすることを確認する**

**Run:** `npx playwright test tests/targetSelection.test.ts`
**Expected:** 全ケース PASS

- [ ] **Step 4: READMEに使い方を追記する**

`README.md` の「タブが開いたら、各タブを順番に確認し、キャプチャ対応・送信ボタンのクリックを人手で行う。すべて終わったらターミナルでEnterキーを押すと、各タブの送信結果を判定してスプレッドシートに記録する。」という段落の直後に、以下の段落を追加する:

```markdown

確認中にCAPTCHA(「私はロボットではありません」等)が表示された企業は、スプレッドシートの「備考」列に「CAPTCHA」という文字列を含めて記入しておくと、次回以降のバッチで自動的にスキップされる。
```

- [ ] **Step 5: コミットする**

```bash
git add src/lib/targetSelection.ts tests/targetSelection.test.ts README.md
git commit -m "feat: skip rows marked CAPTCHA in note on future batches"
```

---

### Task 2: 確認待ち通知モジュールの追加

**Files:**
- Create: `src/lib/notify.ts`
- Test: `tests/notify.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `buildNotifyCommand(openedCount: number): string` — osascriptに渡すAppleScript文字列を組み立てる純粋関数
  - `notifyBatchReady(openedCount: number): Promise<void>` — macOS通知を送るベストエフォート関数(失敗しても例外を投げない)
  - Task 3で `src/index.ts` がこの2つの名前・シグネチャを利用する(`src/index.ts` の変更はTask 3の担当)

- [ ] **Step 1: 失敗するテストを書く**

`tests/notify.test.ts` を新規作成する:

```ts
import { test, expect } from "@playwright/test";
import { buildNotifyCommand } from "../src/lib/notify.js";

test("buildNotifyCommand は件数・タイトル・サウンドを含む通知コマンドを返す", () => {
  const command = buildNotifyCommand(5);
  expect(command).toContain("5件のタブを開きました。確認・送信をお願いします。");
  expect(command).toContain("auto-form");
  expect(command).toContain("Glass");
});

test("buildNotifyCommand は件数が変わると文言も変わる", () => {
  expect(buildNotifyCommand(1)).toContain("1件のタブを開きました");
  expect(buildNotifyCommand(20)).toContain("20件のタブを開きました");
});
```

**Run:** `npx playwright test tests/notify.test.ts`
**Expected:** FAIL(`../src/lib/notify.js` が存在しないためモジュール解決エラー)

- [ ] **Step 2: `src/lib/notify.ts` を作成する**

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function buildNotifyCommand(openedCount: number): string {
  const message = `${openedCount}件のタブを開きました。確認・送信をお願いします。`;
  return `display notification "${message}" with title "auto-form" sound name "Glass"`;
}

export async function notifyBatchReady(openedCount: number): Promise<void> {
  if (process.platform !== "darwin") return;
  try {
    await execFileAsync("osascript", ["-e", buildNotifyCommand(openedCount)]);
  } catch (error) {
    console.warn(`通知の送信に失敗しました: ${String(error)}`);
  }
}
```

- [ ] **Step 3: テストを実行してパスすることを確認する**

**Run:** `npx playwright test tests/notify.test.ts`
**Expected:** 全ケース PASS

- [ ] **Step 4: コミットする**

```bash
git add src/lib/notify.ts tests/notify.test.ts
git commit -m "feat: add buildNotifyCommand/notifyBatchReady for batch-ready macOS notification"
```

---

### Task 3: `src/index.ts` にバッチ完了通知を配線する

**Files:**
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `notifyBatchReady(openedCount: number): Promise<void>`(Task 2で作成)
- Produces: なし(CLIエントリーポイントの配線のみ)

- [ ] **Step 1: importを追加する**

`src/index.ts` の先頭付近、`import { checkSubmissionOutcome } from "./lib/completionCheck.js";` の行の直後に追加する:

```ts
import { notifyBatchReady } from "./lib/notify.js";
```

- [ ] **Step 2: バッチオープンループの直後・`rl.question` 呼び出しの直前に通知呼び出しを追加する**

`src/index.ts` の以下の箇所:

```ts
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      await rl.question(
        `\n${opened.length}件のタブを開きました。確認・送信が終わったらEnterキーを押してください...`,
      );
      rl.close();
```

を、以下に置き換える:

```ts
      if (opened.length > 0) {
        await notifyBatchReady(opened.length);
      }

      const rl = createInterface({ input: process.stdin, output: process.stdout });
      await rl.question(
        `\n${opened.length}件のタブを開きました。確認・送信が終わったらEnterキーを押してください...`,
      );
      rl.close();
```

- [ ] **Step 3: TypeScriptのビルドが通ることを確認する**

**Run:** `npx tsc -p tsconfig.json --noEmit`
**Expected:** エラーなし

- [ ] **Step 4: 全テストを実行してパスすることを確認する**

**Run:** `npx playwright test`
**Expected:** 全ケース PASS(既存テストも含めて壊れていないこと)

- [ ] **Step 5: 動作確認(手動)**

macOS環境で `npm run dev -- --batch-size 1` を実行し、タブが1件開いて確認待ちになったタイミングで画面右上に「auto-form」の通知バナーとサウンドが鳴ることを目視確認する。

- [ ] **Step 6: コミットする**

```bash
git add src/index.ts
git commit -m "feat: notify via macOS banner when batch is ready for confirmation"
```

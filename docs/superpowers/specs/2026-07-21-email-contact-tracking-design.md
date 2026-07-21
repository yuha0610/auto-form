# 問い合わせ先メールアドレスの記録 設計

## 背景

企業によっては、お問い合わせフォームを持たず「お問い合わせは info@example.com まで」のように、リンク先が `mailto:` になっているケースがある。現状は `findContactFormUrl`(`src/lib/formDiscovery.ts`)が見つけたリンクを無条件に`page.goto`しようとするため、`mailto:` リンクだと遷移に失敗し、「読み込み失敗(要確認)」として扱われてしまい、メールアドレス自体は失われる。

`mailto:` リンクを検出した場合はメールアドレスをスプレッドシートに記録し、フォーム送信は試みない(メール送信自体は別途手動で行う前提)。

## スコープ

- 検出対象は `findContactFormUrl` が返す `mailto:` リンクのみ(ページ本文中のテキストとして書かれたメールアドレスの抽出は対象外)
- メール送信の自動化は対象外(記録のみ)

## 変更1: スプレッドシートに列を追加

ヘッダー行に新しい列「メールアドレス」を追加する(READMEのセットアップ手順に追記。既存の「フォームURL」列追加の手順と同様)。

`src/types.ts` の `COLUMNS` に追加する。

```ts
export const COLUMNS = {
  // ...既存項目...
  email: "メールアドレス",
} as const;
```

`SheetRowData` に `email: string` を追加し、`src/lib/sheetData.ts` の `parseSheetRows` で読み込む。

列がスプレッドシートに存在しない場合、既存の必須列と同様に `findColumnIndex` が例外を投げてツール全体が起動しなくなる(既存の「フォームURL」列などと同じ挙動)。README手順の追記により、ユーザーが事前に列を追加することを前提とする。

## 変更2: `mailto:` リンクの検出

`src/lib/formDiscovery.ts` に以下を追加する。

```ts
export function extractMailto(href: string): string | null
```

- `href` が `mailto:` で始まる場合、`mailto:` を除去し `?subject=...` 等のクエリ部分を除いたメールアドレス部分のみを返す
- `mailto:` で始まらない場合は `null` を返す

## 変更3: `src/index.ts` のバッチ実行フロー

`findContactFormUrl` で発見したリンクを`goto`する前に、`extractMailto` でメールアドレスかどうかを判定する。

```ts
const discovered = await findContactFormUrl(page);
if (!discovered) {
  // 既存の「フォーム無(要確認)」処理はそのまま
}

const email = extractMailto(discovered);
if (email) {
  console.warn(`[${target.row.companyName}] お問い合わせ先がメールアドレスでした: ${email}`);
  outcomeUpdates.push({
    rowIndex: target.row.rowIndex,
    attemptNumber: target.attemptNumber,
    outcome: "email",
    existingNote: target.row.note,
    email,
  });
  expectedCompanyName.set(target.row.rowIndex, target.row.companyName);
  await page.close();
  continue;
}

await gotoWithRetry(page, discovered, { waitUntil: "domcontentloaded" });
formUrl = discovered;
```

この行は送信を試みていないため、送信日時(フォーム営業N回目)列・備考列は更新しない。

## 変更4: `src/lib/updates.ts`

`OutcomeUpdate.outcome` の型に `"email"` を追加し、`email?: string` フィールドを追加する。

```ts
export interface OutcomeUpdate {
  rowIndex: number;
  attemptNumber: AttemptNumber;
  outcome: "success" | "uncertain" | "failed" | "email";
  existingNote: string;
  formUrl?: string;
  failureReason?: string;
  email?: string;
}
```

`buildUpdates` に分岐を追加する。

```ts
if (update.outcome === "email" && update.email) {
  writes.push({
    rowIndex: update.rowIndex,
    columnName: COLUMNS.email,
    value: update.email,
  });
}
```

既存の送信日時書き込み条件(`outcome === "success" || outcome === "uncertain"`)には `"email"` を含めないため、この分岐が新設されるだけで既存動作に影響はない。

## 変更5: 今後のバッチでの自動スキップ

`src/lib/targetSelection.ts` の `isSkipped` を変更し、「メールアドレス」列に値がある行は備考の`SKIP_MARKERS`と同様にスキップ対象にする。

```ts
export function isSkipped(row: SheetRowData): boolean {
  return SKIP_MARKERS.some((marker) => row.note.includes(marker)) || row.email.trim() !== "";
}
```

`summarizeSkipped` にも「メールアドレス登録済み」区分を追加し、`--skip-report` 実行時にメールアドレス起因のスキップ件数・企業名も表示されるようにする。

## テスト

- `tests/formDiscovery.test.ts`: `extractMailto` が `mailto:` リンクからメールアドレスを抽出すること、クエリパラメータ付き(`mailto:foo@example.com?subject=...`)でも正しく抽出すること、`mailto:` でない場合は `null` を返すことを確認する
- `tests/updates.test.ts`: `outcome: "email"` の場合に「メールアドレス」列への書き込みのみが生成され、送信日時・備考は書き込まれないことを確認する
- `tests/targetSelection.test.ts`: 「メールアドレス」列に値がある行が `getNextAttempt` / `selectBatch` でスキップされること、`summarizeSkipped` に反映されることを確認する

## スコープ外

- ページ本文中のテキストとして書かれたメールアドレス(リンクを伴わないもの)の検出
- メール送信の自動化
- 過去にすでに「読み込み失敗」等で処理済みの行を遡って再スキャンする機能

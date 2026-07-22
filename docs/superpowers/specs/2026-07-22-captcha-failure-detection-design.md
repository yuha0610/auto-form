# CAPTCHA検証失敗の自動検知 設計

## 背景

reCAPTCHA(invisible/Enterprise)などを使っているサイトでは、Playwrightで操作しているブラウザが自動化ツールとして検知され、人が正しく操作しても「CAPTCHAの検証に失敗しました」のような表示が出て送信できないことがある(例: tradom.jp/contact-inquiry)。reCAPTCHA自体の自動突破は意図的にスコープ外(`docs/superpowers/specs/2026-07-13-captcha-skip-and-notify-design.md`)のため、これまではユーザーが気づいた都度、備考欄に手動で「CAPTCHA」と記入して次回以降スキップさせていた。

この手動記入を、確認・送信後の結果チェック(`checkSubmissionOutcome`)でCAPTCHA失敗の文言を自動検知し、備考欄への記入まで自動化する。

## スコープ

- 検知対象は `checkSubmissionOutcome` が呼ばれるタイミング(タブを開き終えて人が確認・送信作業を終えた後)のページ本文のみ
- reCAPTCHA自体の自動突破・回避は引き続き対象外
- 過去にすでに「要確認」等で処理済みの行を遡って再スキャンする機能は対象外

## 変更1: `src/lib/completionCheck.ts` に検知ロジックを追加

`SUCCESS_KEYWORDS` と同様の場所に、CAPTCHA失敗判定を追加する。「captcha」という語(大小文字区別なし)と、失敗を示す語の両方がページ本文に含まれるかで判定する(広めのパターンで開始する方針)。

```ts
const CAPTCHA_FAILURE_TERMS = ["失敗", "エラー", "できません", "failed", "error", "invalid"];

function isCaptchaFailure(bodyText: string): boolean {
  return bodyText.includes("captcha") && CAPTCHA_FAILURE_TERMS.some((t) => bodyText.includes(t));
}
```

`bodyText` は既存コードと同じく `page.locator("body").innerText()` の結果を小文字化したものを使う。「recaptcha」は「captcha」を部分文字列として含むため追加のキーワードは不要。「認証」「検証」のような一般語だけでは反応しないため、CAPTCHAと無関係な認証エラーを誤検知しない。

## 変更2: `checkSubmissionOutcome` の戻り値を拡張

新しい `outcome` の種類(例: `"captcha"`)を増やすのではなく、既存の `"failed"` + `failureReason` の仕組みをそのまま使う(「フォーム無(要確認)」などと同じ経路)。`failureReason` に `"CAPTCHA"` を渡せば、既存の `SKIP_MARKERS`(備考に「CAPTCHA」を含む行をスキップ)にそのまま一致するため、`src/lib/targetSelection.ts` の変更は不要。

```ts
export async function checkSubmissionOutcome(
  page: Page,
  originalUrl: string,
): Promise<{ outcome: "success" | "uncertain" | "failed"; failureReason?: string }> {
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

CAPTCHA失敗と判定した行は「フォーム営業N回目」の日付を書き込まない(`buildUpdates` は `outcome === "success" || outcome === "uncertain"` の場合のみ日付を書くため、`"failed"` は既存動作のまま日付を書かない)。

## 変更3: `src/index.ts` の呼び出し箇所を修正

戻り値がオブジェクトになるのに合わせて、呼び出し箇所を修正する。

```ts
const { outcome, failureReason } = await checkSubmissionOutcome(entry.page, entry.formUrl);
outcomeUpdates.push({
  rowIndex: entry.target.row.rowIndex,
  attemptNumber: entry.target.attemptNumber,
  outcome,
  existingNote: entry.target.row.note,
  formUrl: entry.discoveredUrl,
  failureReason,
});
```

catchブロック(送信結果の確認自体に失敗した場合)は既存通り `outcome: "uncertain"` のまま変更しない。

## テスト

- `tests/completionCheck.test.ts`:
  - 「CAPTCHAの検証に失敗しました」を含む本文 → `{ outcome: "failed", failureReason: "CAPTCHA" }`
  - 「reCAPTCHA error」など英語表記の本文 → 同上(広めのパターンマッチの確認)
  - 「認証に失敗しました」のような、captchaという語を含まない一般的な認証エラー文言 → 誤検知せず `{ outcome: "uncertain" }` のままであること
  - 既存の成功キーワードを含む本文 → 従来通り `{ outcome: "success" }`(CAPTCHA判定に横取りされないこと)
- `tests/updates.test.ts`: `outcome: "failed"`, `failureReason: "CAPTCHA"` の場合に備考欄へ「CAPTCHA」が書き込まれ、送信日時列は書き込まれないことを確認するケースを追加(既存の`failureReason`テストパターンを踏襲)

## スコープ外

- reCAPTCHA/CAPTCHAの自動突破・回避
- CAPTCHA以外の失敗理由の自動検知
- キーワードリストの継続拡張の仕組み化(今後実例が出た都度、手動でリストに追記する運用のまま)
- 過去の行の遡及的な再スキャン

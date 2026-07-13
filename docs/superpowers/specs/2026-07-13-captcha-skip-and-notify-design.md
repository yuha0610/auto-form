# CAPTCHA事前スキップ & 確認待ち通知 設計

## 背景

フォーム送信の最終確認・送信ボタンのクリック・reCAPTCHA(「私はロボットではありません」)対応は、意図的に人手に残している(README参照)。これ自体は変えないが、以下2点で人の作業負担を減らす:

1. 過去にCAPTCHAが出たとわかっているサイトを、次回以降自動的にバッチ対象から外せるようにする
2. タブを開き終えて確認・送信待ちになったタイミングを、ターミナルに張り付かなくても気づけるようにする

reCAPTCHA自体を自動突破する機能は対象外(意図的に人手のまま)。

## 変更1: CAPTCHA事前スキップ

`src/lib/targetSelection.ts` の `SKIP_MARKERS` 配列に `"CAPTCHA"` を追加する。

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

`isSkipped()` は `row.note.includes(marker)` で判定しているため、備考欄に「CAPTCHA」という文字列を含む値(例:「CAPTCHAあり」)を人が手動で入力すれば、`getNextAttempt()` が `null` を返し、以降のバッチで自動的に除外される。

自動検知は行わない(検知ロジックはスコープ外、今回は手動マーキングのみ)。

README の「使い方」節に、CAPTCHAに気づいた場合は備考欄に「CAPTCHA」と記入すると次回以降スキップされる旨を追記する。

## 変更2: 確認待ち通知(macOS通知バナー+音)

新規ファイル `src/lib/notify.ts` を作成する。

```ts
export function buildNotifyCommand(openedCount: number): string
export async function notifyBatchReady(openedCount: number): Promise<void>
```

- `buildNotifyCommand(openedCount)`: 純粋関数。`osascript -e` に渡す AppleScript 文字列を組み立てて返す。
  - タイトル: `auto-form`
  - 本文: `${openedCount}件のタブを開きました。確認・送信をお願いします。`
  - サウンド: `Glass`
  - ダブルクォートやバックスラッシュなどAppleScript文字列リテラルを壊す文字は含まれない想定(件数は数値のみ)なのでエスケープ処理は行わない。
- `notifyBatchReady(openedCount)`:
  - `process.platform !== "darwin"` の場合は何もせず即座に return(no-op)
  - `darwin` の場合、`child_process.execFile("osascript", ["-e", buildNotifyCommand(openedCount)])` を実行
  - 実行に失敗しても例外を投げず、`console.warn` でログを出すのみ(通知の失敗でバッチ処理自体を止めない)

`src/index.ts` の変更:

- タブを開き終えて `rl.question(...)` を呼ぶ直前に、`opened.length > 0` の場合のみ `await notifyBatchReady(opened.length)` を呼ぶ

## テスト

- `tests/targetSelection.test.ts`: 備考欄に「CAPTCHA」を含む行が `getNextAttempt` / `selectBatch` でスキップされることを確認するケースを追加
- `tests/notify.test.ts`: `buildNotifyCommand` が件数を含む文字列を返すことを確認する純粋関数テストのみ追加(実際の `osascript` 実行はテストしない)

## スコープ外

- reCAPTCHA/CAPTCHAの自動検知・自動突破
- macOS以外のOSでの通知(no-opとする)
- 通知音・文言のカスタマイズ設定(ハードコードで固定)

# ページ読み込み失敗の分類と自動リトライ 設計

## 背景

バッチ実行時、`page.goto()` がDNS解決失敗・証明書エラー・タイムアウト・接続エラーなど様々な理由で失敗することがある。現状(`src/index.ts`)は、失敗理由の種類にかかわらずスプレッドシートの備考欄に一律「読み込み失敗(要確認)」と書き込むだけで、実際のエラー内容はターミナルのログにしか出ていない。

そのため、失敗した企業を手動で確認する際に毎回ターミナルログを遡って原因を調べる必要があり、手間になっている。また、タイムアウトや一時的な接続エラーのように、もう一度試せば成功する可能性がある失敗も、初回失敗の時点で確認待ちとして記録されてしまっている。

これを解決するため、(1) エラーの種類を分類して備考欄に具体的な理由を書き込む、(2) 一時的と判断できるエラーはその場で1回だけ自動リトライする、の2つを行う。

## エラー分類

エラーメッセージ文字列(Playwrightが投げる `Error`/`TimeoutError` の `message`)を以下のカテゴリに分類する。

| カテゴリ | 判定(メッセージに含まれる文字列) | リトライ | 備考欄の文言 |
|---|---|---|---|
| DNS | `ERR_NAME_NOT_RESOLVED` | しない(即失敗) | `URL不正(名前解決失敗)` |
| 証明書 | `ERR_CERT_` を含む(`ERR_CERT_COMMON_NAME_INVALID` 等すべて) | しない(即失敗) | `証明書エラー(URL要確認)` |
| タイムアウト | `TimeoutError` (エラー名またはメッセージ先頭) | する(1回) | `タイムアウト(再試行済・要確認)` |
| 接続エラー | `ERR_CONNECTION_CLOSED` / `ERR_CONNECTION_RESET` / `ERR_CONNECTION_REFUSED` / `ERR_CONNECTION_TIMED_OUT` / `ERR_EMPTY_RESPONSE` / `ERR_NETWORK_CHANGED` / `ERR_INTERNET_DISCONNECTED` | する(1回) | `接続エラー(再試行済・要確認)` |
| 不明 | 上記いずれにも該当しない | しない(即失敗、現状維持) | `読み込み失敗(要確認)` |

分類は完全一致でなく部分一致(`includes`)で判定する。Playwrightのエラーメッセージは `page.goto: net::ERR_XXX at <url>` のような形式で、コード部分の文字列が含まれてさえいれば良いため。

## リトライ動作

「する」に分類されたエラーのみ、失敗直後に3秒待機してから同じURL・同じオプションで `page.goto()` をもう一度実行する。

- リトライが成功すれば、呼び出し元には成功として返る(呼び出し元はリトライの有無を意識しない)。
- リトライも失敗したら、そのリトライ時のエラーを改めて分類し、ラベル付きの `NavigationError` を投げる(1回目と2回目でエラー種別が変わる可能性があるため、リトライ後のエラーで再分類する)。
- 「しない」に分類されたエラーは、初回失敗の時点で即座にラベル付きの `NavigationError` を投げる。

## 変更1: 新規ファイル `src/lib/navigation.ts`

```ts
export type GotoErrorCategory = "dns" | "cert" | "timeout" | "connection" | "unknown";

export interface GotoErrorClassification {
  category: GotoErrorCategory;
  retryable: boolean;
  label: string;
}

export class NavigationError extends Error {
  readonly label: string;
  readonly cause: unknown;
  constructor(label: string, cause: unknown);
}

export function classifyGotoError(error: unknown): GotoErrorClassification;

export async function gotoWithRetry(
  page: Page,
  url: string,
  options: { waitUntil: "domcontentloaded" },
): Promise<void>;
```

- `classifyGotoError`: `error` を `String(error)` に変換し、上記の分類テーブルを上から順に部分一致で判定する純粋関数。
- `gotoWithRetry`: `page.goto(url, options)` を試み、失敗したら `classifyGotoError` で分類。`retryable: false` ならその場で `NavigationError` を投げる。`retryable: true` なら3秒待って(`await new Promise(r => setTimeout(r, 3000))`)もう一度 `page.goto` を試み、それでも失敗すれば再分類した結果で `NavigationError` を投げる。
- リトライ待機時間の3秒は定数としてファイル内に定義する(`RETRY_DELAY_MS`)。

## 変更2: `src/index.ts` の変更

3箇所の `page.goto(...)` 呼び出し(formUrlの読み込み・companyUrlの読み込み・discoveredの読み込み)を `gotoWithRetry(page, url, { waitUntil: "domcontentloaded" })` に置き換える。

catchブロック(現在「読み込みに失敗」を処理している箇所)で、`error instanceof NavigationError` なら `error.label` を `failureReason` に使い、そうでなければ現状通り `"読み込み失敗(要確認)"` を使う。

## 変更3: `src/lib/formFillFlow.ts` の変更

30行目の `page.goto(nestedUrl, { waitUntil: "domcontentloaded" })` も同じ `gotoWithRetry` に置き換える。このエラーはそのまま呼び出し元(`index.ts`)の同じcatchブロックに伝播するため、`index.ts` 側の変更だけで分類・記録される。

## テスト

- `tests/navigation.test.ts` を新規作成:
  - `classifyGotoError`: 分類テーブルの各カテゴリについて、対応するエラーメッセージを渡すと期待通りの `category`/`retryable`/`label` が返ることを確認する。未知のエラーメッセージでは `unknown`/`retryable: false` になることを確認する。
  - `gotoWithRetry`: `page.goto` をモックし、(a) 初回成功時はリトライしないこと、(b) リトライ不可なエラーで初回失敗した場合は即座に `NavigationError` を投げ2回目の `goto` を呼ばないこと、(c) リトライ可能なエラーで初回失敗・2回目成功した場合は成功として返ること、(d) 2回とも失敗した場合は2回目のエラーで分類された `NavigationError` を投げることを確認する。3秒待機はテストが遅くならないよう、`RETRY_DELAY_MS` をテストから上書きできるようにするか、`vi.useFakeTimers()` 等で待機をスキップする。

## スコープ外

- リトライ回数を2回以上にする、カテゴリごとに異なる待機時間にする、といったチューニング
- 「不明」カテゴリの自動リトライ
- スプレッドシートの備考欄以外への通知(Slack等)
- `checkSubmissionOutcome`(送信結果確認)側のエラー分類

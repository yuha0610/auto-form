import type { Page } from "playwright";

export type GotoErrorCategory = "dns" | "cert" | "timeout" | "connection" | "unknown";

export interface GotoErrorClassification {
  category: GotoErrorCategory;
  retryable: boolean;
  label: string;
}

const CONNECTION_ERROR_CODES = [
  "ERR_CONNECTION_CLOSED",
  "ERR_CONNECTION_RESET",
  "ERR_CONNECTION_REFUSED",
  "ERR_CONNECTION_TIMED_OUT",
  "ERR_EMPTY_RESPONSE",
  "ERR_NETWORK_CHANGED",
  "ERR_INTERNET_DISCONNECTED",
];

export function classifyGotoError(error: unknown): GotoErrorClassification {
  const message = String(error);

  if (message.includes("ERR_NAME_NOT_RESOLVED")) {
    return { category: "dns", retryable: false, label: "URL不正(名前解決失敗)" };
  }
  if (message.includes("ERR_CERT_")) {
    return { category: "cert", retryable: false, label: "証明書エラー(URL要確認)" };
  }
  if (message.includes("TimeoutError")) {
    return { category: "timeout", retryable: true, label: "タイムアウト(再試行済・要確認)" };
  }
  if (CONNECTION_ERROR_CODES.some((code) => message.includes(code))) {
    return { category: "connection", retryable: true, label: "接続エラー(再試行済・要確認)" };
  }
  return { category: "unknown", retryable: false, label: "読み込み失敗(要確認)" };
}

export class NavigationError extends Error {
  readonly label: string;
  readonly category: GotoErrorCategory;
  readonly cause: unknown;

  constructor(classification: GotoErrorClassification, cause: unknown) {
    super(classification.label);
    this.name = "NavigationError";
    this.label = classification.label;
    this.category = classification.category;
    this.cause = cause;
  }
}

const RETRY_DELAY_MS = 3000;

/**
 * Alpine.js等のx-cloakパターンではJS初期化完了までbody全体がdisplay:noneになり、
 * domcontentloadedの時点では入力欄が軒並み非表示でfillByKeywordが全滅してしまう。
 * 入力欄が1つでも見えるまで短時間だけ待ち、フォームが無いページでは即座に諦める。
 */
const FORM_READY_TIMEOUT_MS = 3000;

async function waitForFormReady(page: Page, timeoutMs: number): Promise<void> {
  await page
    .waitForSelector("input:not([type='hidden']), textarea", {
      state: "visible",
      timeout: timeoutMs,
    })
    .catch(() => {});
}

export async function gotoWithRetry(
  page: Page,
  url: string,
  options: Parameters<Page["goto"]>[1],
  retryDelayMs: number = RETRY_DELAY_MS,
  formReadyTimeoutMs: number = FORM_READY_TIMEOUT_MS,
): Promise<void> {
  try {
    await page.goto(url, options);
    await waitForFormReady(page, formReadyTimeoutMs);
  } catch (error) {
    const classification = classifyGotoError(error);
    if (!classification.retryable) {
      throw new NavigationError(classification, error);
    }

    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));

    try {
      await page.goto(url, options);
      await waitForFormReady(page, formReadyTimeoutMs);
    } catch (retryError) {
      const retryClassification = classifyGotoError(retryError);
      throw new NavigationError(retryClassification, retryError);
    }
  }
}

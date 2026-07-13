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
  readonly cause: unknown;

  constructor(label: string, cause: unknown) {
    super(label);
    this.name = "NavigationError";
    this.label = label;
    this.cause = cause;
  }
}

const RETRY_DELAY_MS = 3000;

export async function gotoWithRetry(
  page: Page,
  url: string,
  options: Parameters<Page["goto"]>[1],
  retryDelayMs: number = RETRY_DELAY_MS,
): Promise<void> {
  try {
    await page.goto(url, options);
  } catch (error) {
    const classification = classifyGotoError(error);
    if (!classification.retryable) {
      throw new NavigationError(classification.label, error);
    }

    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));

    try {
      await page.goto(url, options);
    } catch (retryError) {
      const retryClassification = classifyGotoError(retryError);
      throw new NavigationError(retryClassification.label, retryError);
    }
  }
}

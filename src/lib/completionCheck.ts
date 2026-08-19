import type { Page } from "playwright";
import { buildBodyExcerpt } from "./uncertainLog.js";

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

const CAPTCHA_WIDGET_HOSTS = ["google.com/recaptcha", "hcaptcha.com", "challenges.cloudflare.com"];

async function hasCaptchaWidget(page: Page): Promise<boolean> {
  const selector = CAPTCHA_WIDGET_HOSTS.flatMap((host) => [
    `iframe[src*="${host}"]`,
    `script[src*="${host}"]`,
  ]).join(", ");
  const count = await page.locator(selector).count().catch(() => 0);
  return count > 0;
}

export interface SubmissionOutcome {
  outcome: "success" | "uncertain" | "failed";
  failureReason?: string;
  /** uncertainのときのみ。判定に使ったページ本文の冒頭で、SUCCESS_KEYWORDS拡張の材料にする。 */
  bodyExcerpt?: string;
}

export async function checkSubmissionOutcome(
  page: Page,
  originalUrl: string,
): Promise<SubmissionOutcome> {
  if (page.url() !== originalUrl) {
    return { outcome: "success" };
  }

  const rawBodyText = await page.locator("body").innerText().catch(() => "");
  const bodyText = rawBodyText.toLowerCase();

  const matched = SUCCESS_KEYWORDS.some((keyword) => bodyText.includes(keyword.toLowerCase()));
  if (matched) {
    return { outcome: "success" };
  }

  if (isCaptchaFailure(bodyText)) {
    return { outcome: "failed", failureReason: "CAPTCHA" };
  }

  if (await hasCaptchaWidget(page)) {
    return { outcome: "failed", failureReason: "CAPTCHA" };
  }

  return { outcome: "uncertain", bodyExcerpt: buildBodyExcerpt(rawBodyText) };
}

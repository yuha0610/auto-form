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

  const matched = SUCCESS_KEYWORDS.some((keyword) => bodyText.includes(keyword.toLowerCase()));
  if (matched) {
    return { outcome: "success" };
  }

  if (isCaptchaFailure(bodyText)) {
    return { outcome: "failed", failureReason: "CAPTCHA" };
  }

  return { outcome: "uncertain" };
}

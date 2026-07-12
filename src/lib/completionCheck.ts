import type { Page } from "playwright";

const SUCCESS_KEYWORDS = [
  "ありがとうございました",
  "送信が完了",
  "受け付けました",
  "thank you",
];

export async function checkSubmissionOutcome(
  page: Page,
  originalUrl: string,
): Promise<"success" | "uncertain"> {
  if (page.url() !== originalUrl) {
    return "success";
  }

  const bodyText = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
  const matched = SUCCESS_KEYWORDS.some((keyword) => bodyText.includes(keyword.toLowerCase()));
  return matched ? "success" : "uncertain";
}

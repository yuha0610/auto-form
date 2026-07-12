import { test, expect } from "@playwright/test";
import { injectFillBanner } from "../src/lib/formSubmitter.js";

test("injectFillBanner: 入力済み/未検出のフィールドを表示するバナーを挿入する", async ({ page }) => {
  await page.setContent("<html><body><h1>Contact</h1></body></html>");

  await injectFillBanner(page, ["senderCompany", "senderName"], ["senderPhone"]);

  const bannerText = await page.locator("[data-auto-form-banner]").innerText();
  expect(bannerText).toContain("会社名○");
  expect(bannerText).toContain("氏名○");
  expect(bannerText).toContain("電話✗");
});

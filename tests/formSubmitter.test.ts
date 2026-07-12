import { test, expect } from "@playwright/test";
import { fillForm, injectFillBanner } from "../src/lib/formSubmitter.js";
import type { Template } from "../src/types.js";

test("injectFillBanner: 入力済み/未検出のフィールドを表示するバナーを挿入する", async ({ page }) => {
  await page.setContent("<html><body><h1>Contact</h1></body></html>");

  await injectFillBanner(page, ["senderCompany", "senderName"], ["senderPhone"]);

  const bannerText = await page.locator("[data-auto-form-banner]").innerText();
  expect(bannerText).toContain("会社名○");
  expect(bannerText).toContain("氏名○");
  expect(bannerText).toContain("電話✗");
});

const TEMPLATE: Template = {
  name: "test",
  senderCompany: "テスト株式会社",
  senderName: "テスト太郎",
  senderEmail: "test@example.com",
  senderPhone: "03-1111-2222",
  senderPostalCode: "153-0062",
  senderAddress: "東京都目黒区三田1-12-26",
  subject: "テスト件名",
  message: "テスト本文",
};

test("fillForm: name属性に'subject'を含むradioボタンがあっても例外にならず、テキスト欄にのみ入力する", async ({
  page,
}) => {
  await page.setContent(`
    <html><body>
      <input type="radio" name="your-subject" value="製品に関するお問い合わせ" checked />
      <input type="text" name="your-subject-detail" placeholder="件名" />
    </body></html>
  `);

  const { filledFields, missingFields } = await fillForm(page, TEMPLATE);

  expect(filledFields).toContain("subject");
  expect(missingFields).not.toContain("subject");
  await expect(page.locator("input[name='your-subject-detail']")).toHaveValue("テスト件名");
  await expect(page.locator("input[name='your-subject']")).toBeChecked();
});

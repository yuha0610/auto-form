import { test, expect } from "@playwright/test";
import { fillFormWithDiscovery } from "../src/lib/formFillFlow.js";
import type { Template } from "../src/types.js";

const template: Template = {
  name: "test",
  senderCompany: "テスト株式会社",
  senderName: "山田太郎",
  senderEmail: "yamada@example.com",
  senderPhone: "090-1234-5678",
  subject: "ご相談",
  message: "本文です",
};

test("入力欄が無い案内ページでは、フォームへのリンクをもう一段階たどって入力する", async ({ page }) => {
  await page.route("https://example.test/contact", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<html><body>
        <p>お問い合わせはこちらからお送りください。</p>
        <a href="/contact/form">お問い合わせフォームへ</a>
      </body></html>`,
    }),
  );
  await page.route("https://example.test/contact/form", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<html><body><form>
        <input name="company" placeholder="会社名" />
        <textarea name="message" placeholder="お問い合わせ内容"></textarea>
      </form></body></html>`,
    }),
  );
  await page.goto("https://example.test/contact");

  const result = await fillFormWithDiscovery(page, template);

  expect(result.filledFields).toEqual(expect.arrayContaining(["senderCompany", "message"]));
  expect(result.navigatedTo).toBe("https://example.test/contact/form");
  await expect(page.locator('[name="company"]')).toHaveValue(template.senderCompany);
});

test("たどれるリンクが無ければ元の(空の)結果をそのまま返す", async ({ page }) => {
  await page.route("https://example.test/contact", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<html><body><p>電話でのみ受付しております。</p></body></html>`,
    }),
  );
  await page.goto("https://example.test/contact");

  const result = await fillFormWithDiscovery(page, template);

  expect(result.filledFields).toEqual([]);
  expect(result.navigatedTo).toBeUndefined();
});

test("最初のページで入力できていればそのまま返す(追加のナビゲーションはしない)", async ({ page }) => {
  await page.route("https://example.test/contact", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<html><body><form>
        <input name="company" placeholder="会社名" />
      </form></body></html>`,
    }),
  );
  await page.goto("https://example.test/contact");

  const result = await fillFormWithDiscovery(page, template);

  expect(result.filledFields).toContain("senderCompany");
  expect(result.navigatedTo).toBeUndefined();
});

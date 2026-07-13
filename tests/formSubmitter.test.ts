import { test, expect } from "@playwright/test";
import { injectFillBanner, fillForm } from "../src/lib/formSubmitter.js";
import type { Template } from "../src/types.js";

test("injectFillBanner: 入力済み/未検出のフィールドを表示するバナーを挿入する", async ({ page }) => {
  await page.setContent("<html><body><h1>Contact</h1></body></html>");

  await injectFillBanner(page, ["senderCompany", "senderName"], ["senderPhone"]);

  const bannerText = await page.locator("[data-auto-form-banner]").innerText();
  expect(bannerText).toContain("会社名○");
  expect(bannerText).toContain("氏名○");
  expect(bannerText).toContain("電話✗");
});

const template: Template = {
  name: "test",
  senderCompany: "テスト株式会社",
  senderName: "山田太郎",
  senderEmail: "yamada@example.com",
  senderPhone: "090-1234-5678",
  subject: "ご相談",
  message: "本文です",
};

test("labelタグを使わず隣接するdivだけで項目名を示すフォームでも入力できる", async ({ page }) => {
  await page.setContent(`<html><body><form>
    <div><div>お名前<span>必須</span></div><input /></div>
    <div><div>メールアドレス<span>必須</span></div><input /></div>
    <div><div>電話番号<span>必須</span></div><input /></div>
    <div><div>会社名<span>必須</span></div><input /></div>
    <div><div>お問い合わせ内容<span>必須</span></div><textarea></textarea></div>
  </form></body></html>`);

  const { filledFields } = await fillForm(page, template);

  expect(filledFields).toEqual(
    expect.arrayContaining(["senderCompany", "senderName", "senderEmail", "senderPhone", "message"]),
  );
  await expect(page.locator("input").nth(0)).toHaveValue(template.senderName);
  await expect(page.locator("input").nth(1)).toHaveValue(template.senderEmail);
  await expect(page.locator("input").nth(2)).toHaveValue(template.senderPhone);
  await expect(page.locator("input").nth(3)).toHaveValue(template.senderCompany);
  await expect(page.locator("textarea")).toHaveValue(template.message);
});

test("name属性がキーワードと一致してもtype=hiddenの入力欄は対象にしない", async ({ page }) => {
  await page.setContent(`<html><body><form>
    <input type="hidden" name="message_id" value="1" />
    <textarea name="message" placeholder="お問い合わせ内容"></textarea>
  </form></body></html>`);

  const { filledFields } = await fillForm(page, template);

  expect(filledFields).toContain("message");
  await expect(page.locator('input[name="message_id"]')).toHaveValue("1");
  await expect(page.locator("textarea")).toHaveValue(template.message);
});

test("hidden要素の近くのscriptタグの中身をラベル候補として拾わない(WPForms等)", async ({ page }) => {
  await page.setContent(`<html><body><form>
    <script>console.log('this message has content in it');</script>
    <input type="hidden" name="wpforms[id]" value="1757" />
    <textarea name="message" placeholder="お問い合わせ内容"></textarea>
  </form></body></html>`);

  const { filledFields } = await fillForm(page, template);

  expect(filledFields).toContain("message");
  await expect(page.locator("textarea")).toHaveValue(template.message);
});

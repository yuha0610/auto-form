import { test, expect } from "@playwright/test";
import { checkSubmissionOutcome } from "../src/lib/completionCheck.js";

test("URLが変わっていればsuccess", async ({ page }) => {
  await page.route("https://example.test/contact", (route) =>
    route.fulfill({ contentType: "text/html; charset=utf-8", body: "<html><head><meta charset='utf-8'></head><body>form</body></html>" }),
  );
  await page.route("https://example.test/thanks", (route) =>
    route.fulfill({ contentType: "text/html; charset=utf-8", body: "<html><head><meta charset='utf-8'></head><body>done</body></html>" }),
  );
  await page.goto("https://example.test/contact");
  await page.goto("https://example.test/thanks");

  const result = await checkSubmissionOutcome(page, "https://example.test/contact");
  expect(result).toEqual({ outcome: "success" });
});

test("URLは同じでも完了文言があればsuccess", async ({ page }) => {
  await page.route("https://example.test/contact", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: "<html><head><meta charset='utf-8'></head><body>送信が完了しました。ありがとうございました。</body></html>",
    }),
  );
  await page.goto("https://example.test/contact");

  const result = await checkSubmissionOutcome(page, "https://example.test/contact");
  expect(result).toEqual({ outcome: "success" });
});

test("URLも同じで完了文言もなければuncertain", async ({ page }) => {
  await page.route("https://example.test/contact", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: "<html><head><meta charset='utf-8'></head><body><form><input name='name'></form></body></html>",
    }),
  );
  await page.goto("https://example.test/contact");

  const result = await checkSubmissionOutcome(page, "https://example.test/contact");
  expect(result).toEqual({ outcome: "uncertain" });
});

test("CAPTCHAの検証に失敗しましたと表示されていればfailed(CAPTCHA)", async ({ page }) => {
  await page.route("https://example.test/contact", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: "<html><head><meta charset='utf-8'></head><body>CAPTCHAの検証に失敗しました</body></html>",
    }),
  );
  await page.goto("https://example.test/contact");

  const result = await checkSubmissionOutcome(page, "https://example.test/contact");
  expect(result).toEqual({ outcome: "failed", failureReason: "CAPTCHA" });
});

test("英語のreCAPTCHAエラー表示でもfailed(CAPTCHA)", async ({ page }) => {
  await page.route("https://example.test/contact", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: "<html><head><meta charset='utf-8'></head><body>reCAPTCHA verification error, please try again</body></html>",
    }),
  );
  await page.goto("https://example.test/contact");

  const result = await checkSubmissionOutcome(page, "https://example.test/contact");
  expect(result).toEqual({ outcome: "failed", failureReason: "CAPTCHA" });
});

test("captchaという語を含まない認証エラーは誤検知しない", async ({ page }) => {
  await page.route("https://example.test/contact", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: "<html><head><meta charset='utf-8'></head><body>認証に失敗しました</body></html>",
    }),
  );
  await page.goto("https://example.test/contact");

  const result = await checkSubmissionOutcome(page, "https://example.test/contact");
  expect(result).toEqual({ outcome: "uncertain" });
});

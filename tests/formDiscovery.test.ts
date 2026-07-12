import { test, expect } from "@playwright/test";
import { findContactFormUrl } from "../src/lib/formDiscovery.js";

test("お問い合わせリンクが見つかればフルURLを返す", async ({ page }) => {
  await page.route("https://example.test/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<html><body>
        <a href="/about">会社概要</a>
        <a href="/contact">お問い合わせ</a>
      </body></html>`,
    }),
  );
  await page.goto("https://example.test/");

  const result = await findContactFormUrl(page);
  expect(result).toBe("https://example.test/contact");
});

test("英語の contact リンクも検出する", async ({ page }) => {
  await page.route("https://example.test/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<html><body><a href="/contact-us">Contact</a></body></html>`,
    }),
  );
  await page.goto("https://example.test/");

  const result = await findContactFormUrl(page);
  expect(result).toBe("https://example.test/contact-us");
});

test("該当リンクがなければnullを返す", async ({ page }) => {
  await page.route("https://example.test/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<html><body><a href="/about">会社概要</a></body></html>`,
    }),
  );
  await page.goto("https://example.test/");

  const result = await findContactFormUrl(page);
  expect(result).toBeNull();
});

import { test, expect } from "@playwright/test";
import {
  classifyContactHref,
  extractMailto,
  findContactLink,
} from "../src/lib/formDiscovery.js";

const PAGE_URL = "https://example.test/";

async function serve(page: import("playwright").Page, body: string): Promise<void> {
  await page.route(PAGE_URL, (route) =>
    // charsetを付けないとブラウザがUTF-8として読まず、日本語のリンク文字が照合できない
    route.fulfill({ contentType: "text/html; charset=utf-8", body }),
  );
  await page.goto(PAGE_URL);
}

test("お問い合わせリンクが見つかればフォームとしてフルURLを返す", async ({ page }) => {
  await serve(page, `<a href="/about">会社概要</a><a href="/contact">お問い合わせ</a>`);
  expect(await findContactLink(page)).toEqual({
    kind: "form",
    url: "https://example.test/contact",
  });
});

test("英語の contact リンクも検出する", async ({ page }) => {
  await serve(page, `<a href="/contact-us">Contact</a>`);
  expect(await findContactLink(page)).toEqual({
    kind: "form",
    url: "https://example.test/contact-us",
  });
});

test("該当リンクがなければnullを返す", async ({ page }) => {
  await serve(page, `<a href="/about">会社概要</a>`);
  expect(await findContactLink(page)).toBeNull();
});

test("ハンバーガーメニュー内など非表示のリンクも検出する", async ({ page }) => {
  // innerTextは非表示要素で空文字を返すため、表示状態に関係なく読める必要がある
  await serve(
    page,
    `<nav style="display:none"><a href="/toiawase">お問い合わせ</a></nav>`,
  );
  expect(await findContactLink(page)).toEqual({
    kind: "form",
    url: "https://example.test/toiawase",
  });
});

test("URLエンコードされた日本語のリンク先も検出する", async ({ page }) => {
  await serve(page, `<a href="/pages/%E3%81%8A%E5%95%8F%E3%81%84%E5%90%88%E3%82%8F%E3%81%9B">お問い合わせ</a>`);
  const link = await findContactLink(page);
  expect(link?.kind).toBe("form");
});

test("後から描画されるリンクも、待ち直して検出する", async ({ page }) => {
  await serve(
    page,
    `<div id="root"></div>
     <script>
       setTimeout(() => {
         document.getElementById("root").innerHTML = '<a href="/contact">お問い合わせ</a>';
       }, 700);
     </script>`,
  );
  expect(await findContactLink(page)).toEqual({
    kind: "form",
    url: "https://example.test/contact",
  });
});

test("ページ内アンカーのリンクは、同じページにフォームがあるとみなす", async ({ page }) => {
  await serve(page, `<a href="#form">お問い合わせ</a><form id="form"></form>`);
  expect(await findContactLink(page)).toEqual({ kind: "same-page", url: PAGE_URL });
});

test("href=# のダミーリンクも同じページ扱いにする", async ({ page }) => {
  await serve(page, `<a href="#">Contact</a><form></form>`);
  expect(await findContactLink(page)).toEqual({ kind: "same-page", url: PAGE_URL });
});

test("mailto:リンクはメールとして返す", async ({ page }) => {
  await serve(page, `<a href="mailto:info@example.com">お問い合わせ</a>`);
  expect(await findContactLink(page)).toEqual({ kind: "email", address: "info@example.com" });
});

test("Google Formへのリンクは、自動入力できない行き先として区別する", async ({ page }) => {
  await serve(page, `<a href="https://forms.gle/abcDEF123">お問い合わせ</a>`);
  expect(await findContactLink(page)).toEqual({
    kind: "google-form",
    url: "https://forms.gle/abcDEF123",
  });
});

test("送信できない行き先しかない場合でも、後続の通常フォームを見落とさない", async ({ page }) => {
  // 先頭のmailtoで打ち切ると、下にある本来のフォームに辿り着けない
  await serve(
    page,
    `<a href="mailto:info@example.com">お問い合わせ</a><a href="/contact">お問い合わせフォーム</a>`,
  );
  expect(await findContactLink(page)).toEqual({
    kind: "form",
    url: "https://example.test/contact",
  });
});

test("classifyContactHref: 通常のURLはフォーム扱い", () => {
  expect(classifyContactHref("https://example.test/contact", PAGE_URL)).toEqual({
    kind: "form",
    url: "https://example.test/contact",
  });
});

test("classifyContactHref: ハッシュだけが違う同一URLは同じページ扱い", () => {
  expect(classifyContactHref("https://example.test/#form", PAGE_URL)).toEqual({
    kind: "same-page",
    url: PAGE_URL,
  });
});

test("classifyContactHref: 今いるページ自身へのリンクも同じページ扱い", () => {
  expect(classifyContactHref(PAGE_URL, PAGE_URL)).toEqual({ kind: "same-page", url: PAGE_URL });
});

test("classifyContactHref: docs.google.comのフォームもGoogle Form扱い", () => {
  const url = "https://docs.google.com/forms/d/e/1FAIpQL/viewform";
  expect(classifyContactHref(url, PAGE_URL)).toEqual({ kind: "google-form", url });
});

test("classifyContactHref: tel: や javascript: は行き先として扱わない", () => {
  expect(classifyContactHref("tel:0312345678", PAGE_URL)).toBeNull();
  expect(classifyContactHref("javascript:void(0)", PAGE_URL)).toBeNull();
  expect(classifyContactHref("", PAGE_URL)).toBeNull();
});

test("extractMailto: mailto:リンクからメールアドレスを抽出する", () => {
  expect(extractMailto("mailto:info@example.com")).toBe("info@example.com");
});

test("extractMailto: クエリパラメータ付きのmailto:リンクからもメールアドレスのみ抽出する", () => {
  expect(extractMailto("mailto:info@example.com?subject=お問い合わせ")).toBe("info@example.com");
});

test("extractMailto: mailto:でないリンクはnullを返す", () => {
  expect(extractMailto("https://example.com/contact")).toBeNull();
});

test("extractMailto: スキームが大文字でも判定する", () => {
  expect(extractMailto("MAILTO:info@example.com")).toBe("info@example.com");
});

import { test, expect } from "@playwright/test";
import { classifyGotoError, gotoWithRetry, NavigationError } from "../src/lib/navigation.js";

test("DNS解決失敗はdnsカテゴリ・リトライ不可と判定する", () => {
  const error = new Error("page.goto: net::ERR_NAME_NOT_RESOLVED at https://example.test/");
  expect(classifyGotoError(error)).toEqual({
    category: "dns",
    retryable: false,
    label: "URL不正(名前解決失敗)",
  });
});

test("証明書エラーはcertカテゴリ・リトライ不可と判定する", () => {
  const error = new Error(
    "page.goto: net::ERR_CERT_COMMON_NAME_INVALID at https://example.test/",
  );
  expect(classifyGotoError(error)).toEqual({
    category: "cert",
    retryable: false,
    label: "証明書エラー(URL要確認)",
  });
});

test("PlaywrightのTimeoutErrorはtimeoutカテゴリ・リトライ可能と判定する", () => {
  const error = new Error("page.goto: Timeout 30000ms exceeded.");
  error.name = "TimeoutError";
  expect(classifyGotoError(error)).toEqual({
    category: "timeout",
    retryable: true,
    label: "タイムアウト(再試行済・要確認)",
  });
});

const CONNECTION_CODES = [
  "ERR_CONNECTION_CLOSED",
  "ERR_CONNECTION_RESET",
  "ERR_CONNECTION_REFUSED",
  "ERR_CONNECTION_TIMED_OUT",
  "ERR_EMPTY_RESPONSE",
  "ERR_NETWORK_CHANGED",
  "ERR_INTERNET_DISCONNECTED",
];

CONNECTION_CODES.forEach((code) => {
  test(`${code} はconnectionカテゴリ・リトライ可能と判定する`, () => {
    const error = new Error(`page.goto: net::${code} at https://example.test/`);
    expect(classifyGotoError(error)).toEqual({
      category: "connection",
      retryable: true,
      label: "接続エラー(再試行済・要確認)",
    });
  });
});

test("未知のエラーはunknownカテゴリ・リトライ不可と判定する", () => {
  const error = new Error("something went wrong");
  expect(classifyGotoError(error)).toEqual({
    category: "unknown",
    retryable: false,
    label: "読み込み失敗(要確認)",
  });
});

test("初回のgotoが成功すればリトライしない", async ({ page }) => {
  let callCount = 0;
  await page.route("https://example.test/ok", async (route) => {
    callCount++;
    await route.fulfill({ contentType: "text/html", body: "<html><body>ok</body></html>" });
  });

  await gotoWithRetry(page, "https://example.test/ok", { waitUntil: "domcontentloaded" }, 10);

  expect(callCount).toBe(1);
});

test("リトライ不可なエラー(DNS)は即座にNavigationErrorを投げ、リトライしない", async ({ page }) => {
  let callCount = 0;
  await page.route("https://example.test/dns-fail", async (route) => {
    callCount++;
    await route.abort("namenotresolved");
  });

  await expect(
    gotoWithRetry(page, "https://example.test/dns-fail", { waitUntil: "domcontentloaded" }, 10),
  ).rejects.toThrow(NavigationError);
  expect(callCount).toBe(1);
});

test("リトライ可能なエラーで初回失敗・2回目成功した場合は成功として返る", async ({ page }) => {
  let callCount = 0;
  await page.route("https://example.test/retry-success", async (route) => {
    callCount++;
    if (callCount === 1) {
      await route.abort("connectionreset");
    } else {
      await route.fulfill({ contentType: "text/html", body: "<html><body>ok</body></html>" });
    }
  });

  await gotoWithRetry(
    page,
    "https://example.test/retry-success",
    { waitUntil: "domcontentloaded" },
    50,
  );

  expect(callCount).toBe(2);
});

test("リトライ可能なエラーで2回とも失敗した場合はNavigationErrorを投げる", async ({ page }) => {
  let callCount = 0;
  await page.route("https://example.test/retry-fail", async (route) => {
    callCount++;
    await route.abort("connectionreset");
  });

  const error = await gotoWithRetry(
    page,
    "https://example.test/retry-fail",
    { waitUntil: "domcontentloaded" },
    10,
  ).catch((e) => e);

  expect(error).toBeInstanceOf(NavigationError);
  expect((error as InstanceType<typeof NavigationError>).label).toBe("接続エラー(再試行済・要確認)");
  expect(callCount).toBe(2);
});

test("1回目が接続エラー・2回目がタイムアウトの場合はリトライ側のエラーを再分類してNavigationErrorを投げる", async ({
  page,
}) => {
  let callCount = 0;
  await page.route("https://example.test/retry-then-timeout", async (route) => {
    callCount++;
    if (callCount === 1) {
      await route.abort("connectionreset");
    } else {
      await new Promise(() => {});
    }
  });

  const error = await gotoWithRetry(
    page,
    "https://example.test/retry-then-timeout",
    { waitUntil: "domcontentloaded", timeout: 500 },
    10,
  ).catch((e) => e);

  expect(error).toBeInstanceOf(NavigationError);
  expect((error as InstanceType<typeof NavigationError>).label).toBe("タイムアウト(再試行済・要確認)");
  expect(callCount).toBe(2);
});

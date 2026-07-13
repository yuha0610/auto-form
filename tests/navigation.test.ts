import { test, expect } from "@playwright/test";
import { classifyGotoError } from "../src/lib/navigation.js";

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

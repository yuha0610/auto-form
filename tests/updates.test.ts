import { test, expect } from "@playwright/test";
import { buildUpdates } from "../src/lib/updates.js";
import { COLUMNS } from "../src/types.js";

const today = new Date(2026, 6, 12);

test("success: 該当のフォーム営業N回目列に日付を書く", () => {
  const writes = buildUpdates(
    { rowIndex: 5, attemptNumber: 1, outcome: "success", existingNote: "" },
    today,
  );
  expect(writes).toEqual([
    { rowIndex: 5, columnName: COLUMNS.firstSent, value: "2026/07/12" },
  ]);
});

test("success: フォームURLを新規発見していればフォームURL列も書く", () => {
  const writes = buildUpdates(
    {
      rowIndex: 5,
      attemptNumber: 2,
      outcome: "success",
      existingNote: "",
      formUrl: "https://example.com/contact",
    },
    today,
  );
  expect(writes).toEqual(
    expect.arrayContaining([
      { rowIndex: 5, columnName: COLUMNS.secondSent, value: "2026/07/12" },
      { rowIndex: 5, columnName: COLUMNS.formUrl, value: "https://example.com/contact" },
    ]),
  );
});

test("uncertain: 日付を書きつつ備考に「要確認」を追記する", () => {
  const writes = buildUpdates(
    { rowIndex: 5, attemptNumber: 3, outcome: "uncertain", existingNote: "メール" },
    today,
  );
  expect(writes).toEqual(
    expect.arrayContaining([
      { rowIndex: 5, columnName: COLUMNS.thirdSent, value: "2026/07/12" },
      { rowIndex: 5, columnName: COLUMNS.note, value: "メール / 要確認" },
    ]),
  );
});

test("failed: フォーム営業N回目列には書かず備考に理由を追記する", () => {
  const writes = buildUpdates(
    {
      rowIndex: 5,
      attemptNumber: 1,
      outcome: "failed",
      existingNote: "",
      failureReason: "ページ到達不可",
    },
    today,
  );
  expect(writes).toEqual([
    { rowIndex: 5, columnName: COLUMNS.note, value: "ページ到達不可" },
  ]);
});

test("email: メールアドレス列にのみ書き込み、送信日時・備考は書き込まない", () => {
  const writes = buildUpdates(
    {
      rowIndex: 5,
      attemptNumber: 1,
      outcome: "email",
      existingNote: "",
      email: "info@example.com",
    },
    today,
  );
  expect(writes).toEqual([
    { rowIndex: 5, columnName: COLUMNS.email, value: "info@example.com" },
  ]);
});

test("failed: failureReasonがCAPTCHAの場合も同じ経路で備考へ追記する", () => {
  const writes = buildUpdates(
    {
      rowIndex: 5,
      attemptNumber: 1,
      outcome: "failed",
      existingNote: "",
      failureReason: "CAPTCHA",
    },
    today,
  );
  expect(writes).toEqual([
    { rowIndex: 5, columnName: COLUMNS.note, value: "CAPTCHA" },
  ]);
});

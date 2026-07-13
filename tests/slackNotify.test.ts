import { test, expect } from "@playwright/test";
import { countSentToday, buildSlackPayload } from "../src/lib/slackNotify.js";
import type { SheetRowData } from "../src/types.js";

function makeRow(overrides: Partial<SheetRowData>): SheetRowData {
  return {
    rowIndex: 2,
    companyName: "サンプル株式会社",
    companyUrl: "https://example.com/",
    formUrl: "",
    note: "",
    dealStatus: "無",
    firstSentAt: null,
    secondSentAt: null,
    thirdSentAt: null,
    ...overrides,
  };
}

test("countSentToday: 1回目が今日の日付なら1件としてカウントする", () => {
  const today = new Date(2026, 6, 13);
  const rows = [makeRow({ firstSentAt: "2026/07/13" })];
  expect(countSentToday(rows, today)).toBe(1);
});

test("countSentToday: 今日以外の日付や空欄はカウントしない", () => {
  const today = new Date(2026, 6, 13);
  const rows = [makeRow({ firstSentAt: "2026/07/12" }), makeRow({ firstSentAt: null })];
  expect(countSentToday(rows, today)).toBe(0);
});

test("countSentToday: 複数列に今日の日付が入っていても二重カウントしない", () => {
  const today = new Date(2026, 6, 13);
  const rows = [makeRow({ firstSentAt: "2026/07/13", secondSentAt: "2026/07/13" })];
  expect(countSentToday(rows, today)).toBe(1);
});

test("countSentToday: 複数行はそれぞれカウントする", () => {
  const today = new Date(2026, 6, 13);
  const rows = [
    makeRow({ rowIndex: 2, firstSentAt: "2026/07/13" }),
    makeRow({ rowIndex: 3, secondSentAt: "2026/07/13" }),
    makeRow({ rowIndex: 4, firstSentAt: "2026/06/01" }),
  ];
  expect(countSentToday(rows, today)).toBe(2);
});

test("buildSlackPayload: 件数を含むtextを返す", () => {
  expect(buildSlackPayload(12)).toEqual({ text: "今日の送信: 12件" });
});

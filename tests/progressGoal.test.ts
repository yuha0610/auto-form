import { test, expect } from "@playwright/test";
import { parseGoal, countFirstSent } from "../src/lib/progressGoal.js";
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

test("parseGoal: 正常な数値と日付からGoalを組み立てる", () => {
  const goal = parseGoal("1000", "2026/07/31");
  expect(goal).not.toBeNull();
  expect(goal?.targetCount).toBe(1000);
  expect(goal?.deadline.getFullYear()).toBe(2026);
  expect(goal?.deadline.getMonth()).toBe(6);
  expect(goal?.deadline.getDate()).toBe(31);
});

test("parseGoal: 目標件数が空文字の場合はnullを返す", () => {
  expect(parseGoal("", "2026/07/31")).toBeNull();
});

test("parseGoal: 目標件数が数値でない場合はnullを返す", () => {
  expect(parseGoal("たくさん", "2026/07/31")).toBeNull();
});

test("parseGoal: 目標件数が0以下の場合はnullを返す", () => {
  expect(parseGoal("0", "2026/07/31")).toBeNull();
});

test("parseGoal: 期限がパース不能な場合はnullを返す", () => {
  expect(parseGoal("1000", "")).toBeNull();
});

test("countFirstSent: 1回目列に値がある行だけカウントする", () => {
  const rows = [
    makeRow({ rowIndex: 2, firstSentAt: "2026/07/13" }),
    makeRow({ rowIndex: 3, firstSentAt: null }),
    makeRow({ rowIndex: 4, firstSentAt: "2026/07/01" }),
  ];
  expect(countFirstSent(rows)).toBe(2);
});

test("countFirstSent: 空白のみの値はカウントしない", () => {
  const rows = [makeRow({ rowIndex: 2, firstSentAt: "  " })];
  expect(countFirstSent(rows)).toBe(0);
});

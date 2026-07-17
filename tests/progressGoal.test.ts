import { test, expect } from "@playwright/test";
import {
  parseGoal,
  countFirstSent,
  countRemainingBusinessDays,
  buildProgressMessage,
} from "../src/lib/progressGoal.js";
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

test("countRemainingBusinessDays: 平日のみの期間は日数がそのままカウントされる", () => {
  const today = new Date(2026, 6, 13); // 2026/07/13 月曜
  const deadline = new Date(2026, 6, 16); // 2026/07/16 木曜
  expect(countRemainingBusinessDays(today, deadline)).toBe(3); // 火水木
});

test("countRemainingBusinessDays: 土日を挟む期間は土日を除外する", () => {
  const today = new Date(2026, 6, 17); // 2026/07/17 金曜
  const deadline = new Date(2026, 6, 31); // 2026/07/31 金曜
  expect(countRemainingBusinessDays(today, deadline)).toBe(10);
});

test("countRemainingBusinessDays: 期限が今日と同じ場合は0を返す", () => {
  const today = new Date(2026, 6, 17);
  expect(countRemainingBusinessDays(today, today)).toBe(0);
});

test("countRemainingBusinessDays: 期限が今日より前の場合は0を返す", () => {
  const today = new Date(2026, 6, 17);
  const deadline = new Date(2026, 6, 10);
  expect(countRemainingBusinessDays(today, deadline)).toBe(0);
});

test("buildProgressMessage: 通常時は残り件数と必要ペースを含む", () => {
  const goal = { targetCount: 1000, deadline: new Date(2026, 6, 31) };
  const message = buildProgressMessage(156, goal, 9);
  expect(message).toBe(
    "累計(1回目): 156件 / 目標1000件(残り844件)\n残り営業日: 9日\n必要ペース: 94件/日",
  );
});

test("buildProgressMessage: 目標達成済みの場合は達成メッセージを返す", () => {
  const goal = { targetCount: 1000, deadline: new Date(2026, 6, 31) };
  const message = buildProgressMessage(1020, goal, 9);
  expect(message).toBe("累計(1回目): 1020件 / 目標1000件 達成済み🎉");
});

test("buildProgressMessage: 残り営業日0かつ未達成の場合は期限切れメッセージを返す", () => {
  const goal = { targetCount: 1000, deadline: new Date(2026, 6, 31) };
  const message = buildProgressMessage(800, goal, 0);
  expect(message).toBe(
    "累計(1回目): 800件 / 目標1000件(残り200件)\n期限(2026/07/31)を過ぎています",
  );
});

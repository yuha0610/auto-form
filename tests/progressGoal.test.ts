import { test, expect } from "@playwright/test";
import {
  parseGoal,
  countFirstSent,
  countRemainingBusinessDays,
  buildProgressMessage,
  getWeekStart,
  countBusinessDaysInclusive,
  countSentThisWeek,
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

test("buildProgressMessage: 通常時は残り件数・必要ペース・今週の状況を含む", () => {
  const goal = { targetCount: 1000, deadline: new Date(2026, 6, 31) };
  const weekStart = new Date(2026, 6, 13); // 07/13週
  const message = buildProgressMessage(156, goal, 9, 12, 1, weekStart);
  expect(message).toBe(
    "累計(1回目): 156件 / 目標1000件(残り844件)\n残り営業日: 9日\n必要ペース: 94件/日\n今週(07/13週): 12件 / 週残り目標94件",
  );
});

test("buildProgressMessage: 目標達成済みの場合は達成メッセージのみ返す(週次行なし)", () => {
  const goal = { targetCount: 1000, deadline: new Date(2026, 6, 31) };
  const weekStart = new Date(2026, 6, 13);
  const message = buildProgressMessage(1020, goal, 9, 12, 1, weekStart);
  expect(message).toBe("累計(1回目): 1020件 / 目標1000件 達成済み🎉");
});

test("buildProgressMessage: 残り営業日0かつ未達成の場合は期限切れメッセージのみ返す(週次行なし)", () => {
  const goal = { targetCount: 1000, deadline: new Date(2026, 6, 31) };
  const weekStart = new Date(2026, 6, 13);
  const message = buildProgressMessage(800, goal, 0, 12, 0, weekStart);
  expect(message).toBe(
    "累計(1回目): 800件 / 目標1000件(残り200件)\n期限(2026/07/31)を過ぎています",
  );
});

test("getWeekStart: 週の途中の平日から月曜日を返す", () => {
  const wednesday = new Date(2026, 6, 15); // 2026/07/15 水曜
  const start = getWeekStart(wednesday);
  expect(start.getFullYear()).toBe(2026);
  expect(start.getMonth()).toBe(6);
  expect(start.getDate()).toBe(13); // 2026/07/13 月曜
});

test("getWeekStart: 日曜日からは同じ週の月曜日を返す(前週ではない)", () => {
  const sunday = new Date(2026, 6, 19); // 2026/07/19 日曜
  const start = getWeekStart(sunday);
  expect(start.getDate()).toBe(13); // 同じ週の2026/07/13 月曜
});

test("getWeekStart: 月曜日自身を渡すとその日をそのまま返す", () => {
  const monday = new Date(2026, 6, 13);
  const start = getWeekStart(monday);
  expect(start.getDate()).toBe(13);
});

test("countBusinessDaysInclusive: 両端が平日なら日数をそのままカウントする", () => {
  const from = new Date(2026, 6, 13); // 月曜
  const to = new Date(2026, 6, 17); // 金曜
  expect(countBusinessDaysInclusive(from, to)).toBe(5);
});

test("countBusinessDaysInclusive: fromとtoが同じ平日なら1を返す", () => {
  const day = new Date(2026, 6, 17); // 金曜
  expect(countBusinessDaysInclusive(day, day)).toBe(1);
});

test("countBusinessDaysInclusive: 土日を挟む場合は除外する", () => {
  const from = new Date(2026, 6, 13); // 月曜
  const to = new Date(2026, 6, 19); // 日曜
  expect(countBusinessDaysInclusive(from, to)).toBe(5); // 月〜金の5日
});

test("countBusinessDaysInclusive: fromがtoより後なら0を返す", () => {
  const from = new Date(2026, 6, 17);
  const to = new Date(2026, 6, 13);
  expect(countBusinessDaysInclusive(from, to)).toBe(0);
});

test("countSentThisWeek: 週の範囲内(月曜〜今日)の送信をカウントする", () => {
  const weekStart = new Date(2026, 6, 13); // 月曜
  const today = new Date(2026, 6, 16); // 木曜
  const rows = [
    makeRow({ rowIndex: 2, firstSentAt: "2026/07/13" }), // 月曜(範囲内)
    makeRow({ rowIndex: 3, firstSentAt: "2026/07/16" }), // 今日(範囲内)
    makeRow({ rowIndex: 4, firstSentAt: "2026/07/10" }), // 先週(範囲外)
    makeRow({ rowIndex: 5, firstSentAt: null }),
  ];
  expect(countSentThisWeek(rows, weekStart, today)).toBe(2);
});

test("countSentThisWeek: 来週の日付は範囲外としてカウントしない", () => {
  const weekStart = new Date(2026, 6, 13);
  const today = new Date(2026, 6, 16);
  const rows = [makeRow({ rowIndex: 2, firstSentAt: "2026/07/20" })];
  expect(countSentThisWeek(rows, weekStart, today)).toBe(0);
});

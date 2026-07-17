import type { sheets_v4 } from "googleapis";
import type { SheetRowData } from "../types.js";
import { formatSheetDate, parseSheetDate } from "./targetSelection.js";

export interface Goal {
  targetCount: number;
  deadline: Date;
}

export function parseGoal(targetCountRaw: string, deadlineRaw: string): Goal | null {
  const targetCount = Number(targetCountRaw);
  if (!Number.isFinite(targetCount) || targetCount <= 0) return null;

  const deadline = parseSheetDate(deadlineRaw || null);
  if (!deadline) return null;

  return { targetCount, deadline };
}

export function countFirstSent(rows: SheetRowData[]): number {
  return rows.filter((row) => (row.firstSentAt ?? "").trim() !== "").length;
}

function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

export function countRemainingBusinessDays(today: Date, deadline: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const deadlineMidnight = new Date(
    deadline.getFullYear(),
    deadline.getMonth(),
    deadline.getDate(),
  );

  let count = 0;
  for (
    let d = new Date(todayMidnight.getTime() + msPerDay);
    d.getTime() <= deadlineMidnight.getTime();
    d = new Date(d.getTime() + msPerDay)
  ) {
    if (!isWeekend(d)) count++;
  }
  return count;
}

export function buildProgressMessage(
  totalSent: number,
  goal: Goal,
  remainingBusinessDays: number,
): string {
  if (totalSent >= goal.targetCount) {
    return `累計(1回目): ${totalSent}件 / 目標${goal.targetCount}件 達成済み🎉`;
  }

  const remainingCount = goal.targetCount - totalSent;
  const base = `累計(1回目): ${totalSent}件 / 目標${goal.targetCount}件(残り${remainingCount}件)`;

  if (remainingBusinessDays === 0) {
    return `${base}\n期限(${formatSheetDate(goal.deadline)})を過ぎています`;
  }

  const requiredPace = Math.ceil(remainingCount / remainingBusinessDays);
  return `${base}\n残り営業日: ${remainingBusinessDays}日\n必要ペース: ${requiredPace}件/日`;
}

export async function fetchGoal(
  client: sheets_v4.Sheets,
  spreadsheetId: string,
): Promise<Goal | null> {
  const meta = await client.spreadsheets.get({ spreadsheetId });
  const hasProgressSheet = meta.data.sheets?.some(
    (sheet) => sheet.properties?.title === "進捗",
  );
  if (!hasProgressSheet) return null;

  const res = await client.spreadsheets.values.get({
    spreadsheetId,
    range: "進捗!B1:B2",
  });
  const values = res.data.values ?? [];
  const targetCountRaw = values[0]?.[0] ?? "";
  const deadlineRaw = values[1]?.[0] ?? "";
  return parseGoal(targetCountRaw, deadlineRaw);
}

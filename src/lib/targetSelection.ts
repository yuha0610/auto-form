import type { AttemptNumber, EligibleTarget, SheetRowData } from "../types.js";

const SKIP_MARKERS = [
  "フォーム無",
  "Google Formで不可",
  "電話のみ",
  "サポートのみ",
  "リンク切れ",
  "メール",
];

const FOLLOW_UP_INTERVAL_DAYS = 30;

export function parseSheetDate(value: string | null): Date | null {
  if (!value) return null;
  const parts = value.split("/").map(Number);
  const [year, month, day] = parts;
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

export function formatSheetDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

function daysBetween(from: Date, to: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor((to.getTime() - from.getTime()) / msPerDay);
}

export function isSkipped(row: SheetRowData): boolean {
  return SKIP_MARKERS.some((marker) => row.note.includes(marker));
}

export function getNextAttempt(row: SheetRowData, today: Date): AttemptNumber | null {
  if (row.dealStatus === "あり") return null;
  if (isSkipped(row)) return null;

  if (!row.firstSentAt) return 1;
  if (row.thirdSentAt) return null;

  if (!row.secondSentAt) {
    const first = parseSheetDate(row.firstSentAt);
    if (!first) return null;
    return daysBetween(first, today) >= FOLLOW_UP_INTERVAL_DAYS ? 2 : null;
  }

  const second = parseSheetDate(row.secondSentAt);
  if (!second) return null;
  return daysBetween(second, today) >= FOLLOW_UP_INTERVAL_DAYS ? 3 : null;
}

export function selectBatch(
  rows: SheetRowData[],
  batchSize: number,
  today: Date,
): EligibleTarget[] {
  const result: EligibleTarget[] = [];
  for (const row of rows) {
    if (result.length >= batchSize) break;
    const attemptNumber = getNextAttempt(row, today);
    if (attemptNumber !== null) {
      result.push({ row, attemptNumber });
    }
  }
  return result;
}

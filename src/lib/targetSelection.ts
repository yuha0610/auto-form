import type { AttemptNumber, EligibleTarget, SheetRowData } from "../types.js";

const SKIP_MARKERS = [
  "フォーム無",
  "Google Formで不可",
  "電話のみ",
  "サポートのみ",
  "リンク切れ",
  "メール",
  "CAPTCHA",
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
  if (row.dealStatus.trim() !== "") return null;
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

function normalizeCompanyName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "");
}

function attemptProgress(row: SheetRowData): number {
  if (row.thirdSentAt) return 3;
  if (row.secondSentAt) return 2;
  if (row.firstSentAt) return 1;
  return 0;
}

/**
 * 同一企業名の行が複数存在する場合、送信が最も進んでいる行だけを残す。
 * (行の重複により同じ企業に二重送信してしまうのを防ぐ)
 */
export function dedupeByCompanyName(rows: SheetRowData[]): SheetRowData[] {
  const bestByName = new Map<string, SheetRowData>();
  for (const row of rows) {
    const key = normalizeCompanyName(row.companyName);
    if (!key) continue;
    const existing = bestByName.get(key);
    if (!existing || attemptProgress(row) > attemptProgress(existing)) {
      bestByName.set(key, row);
    }
  }

  const best = new Set(bestByName.values());
  return rows.filter((row) => !normalizeCompanyName(row.companyName) || best.has(row));
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

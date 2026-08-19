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

const FOLLOW_UP_INTERVAL_DAYS = 14;

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

const EMAIL_ON_FILE_REASON = "メールアドレス登録済み";

export function isSkipped(row: SheetRowData): boolean {
  return SKIP_MARKERS.some((marker) => row.note.includes(marker)) || row.email.trim() !== "";
}

export interface SkipSummary {
  reason: string;
  companies: string[];
}

/** スキップされた行を、備考に含まれるスキップ理由・メールアドレス登録済みかどうかごとに集計する。 */
export function summarizeSkipped(rows: SheetRowData[]): SkipSummary[] {
  const companiesByReason = new Map<string, string[]>();
  for (const row of rows) {
    const reason = SKIP_MARKERS.find((marker) => row.note.includes(marker));
    if (reason) {
      if (!companiesByReason.has(reason)) companiesByReason.set(reason, []);
      companiesByReason.get(reason)!.push(row.companyName);
      continue;
    }
    if (row.email.trim() !== "") {
      if (!companiesByReason.has(EMAIL_ON_FILE_REASON)) companiesByReason.set(EMAIL_ON_FILE_REASON, []);
      companiesByReason.get(EMAIL_ON_FILE_REASON)!.push(row.companyName);
    }
  }

  const reasons = [...SKIP_MARKERS, EMAIL_ON_FILE_REASON];
  return reasons.filter((reason) => companiesByReason.has(reason)).map((reason) => ({
    reason,
    companies: companiesByReason.get(reason)!,
  }));
}

function computeAttemptNumber(row: SheetRowData, today: Date): AttemptNumber | null {
  if (row.dealStatus.trim() !== "") return null;

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

export function getNextAttempt(row: SheetRowData, today: Date): AttemptNumber | null {
  if (isSkipped(row)) return null;
  return computeAttemptNumber(row, today);
}

const FORM_MISSING_MARKER = "フォーム無";

/** 自動発見でフォームが見つからず(備考に「フォーム無」が付いて)スキップされている行を、手動確認用に再度対象にする。 */
export function selectFormMissingRetryTargets(
  rows: SheetRowData[],
  today: Date,
): EligibleTarget[] {
  const targets: EligibleTarget[] = [];
  for (const row of rows) {
    if (!row.note.includes(FORM_MISSING_MARKER)) continue;
    const attemptNumber = computeAttemptNumber(row, today);
    if (attemptNumber !== null) {
      targets.push({ row, attemptNumber });
    }
  }
  return targets;
}

export function hasRecentSignal(row: SheetRowData, today: Date): boolean {
  const signalDate = parseSheetDate(row.signalDate);
  if (!signalDate) return false;
  return daysBetween(signalDate, today) <= FOLLOW_UP_INTERVAL_DAYS;
}

function normalizeCompanyName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "");
}

export function attemptProgress(row: SheetRowData): number {
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
  const eligible: EligibleTarget[] = [];
  for (const row of rows) {
    const attemptNumber = getNextAttempt(row, today);
    if (attemptNumber !== null) {
      eligible.push({ row, attemptNumber });
    }
  }

  const sorted = [...eligible].sort((a, b) => {
    const aHot = hasRecentSignal(a.row, today) ? 0 : 1;
    const bHot = hasRecentSignal(b.row, today) ? 0 : 1;
    return aHot - bHot;
  });

  return sorted.slice(0, batchSize);
}

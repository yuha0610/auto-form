import type { SheetRowData } from "../types.js";

/** 送信できたか判定できなかったときに付く印。 */
const UNCERTAIN_MARKER = "要確認";

export interface UncertainRow extends SheetRowData {
  /** 最後に送信日が入った回。人が見直すのはこの回。 */
  lastAttempt: { number: 1 | 2 | 3; sentAt: string };
}

function lastAttemptOf(row: SheetRowData): { number: 1 | 2 | 3; sentAt: string } | null {
  if (row.thirdSentAt) return { number: 3, sentAt: row.thirdSentAt };
  if (row.secondSentAt) return { number: 2, sentAt: row.secondSentAt };
  if (row.firstSentAt) return { number: 1, sentAt: row.firstSentAt };
  return null;
}

/**
 * 送信日は入っているが、送信できたかは確認が取れていない行を集める。
 * 「読み込み失敗(要確認)」など他の印は失敗として別に記録済みなので対象にしない。
 */
export function selectUncertainRows(rows: SheetRowData[]): UncertainRow[] {
  const found: UncertainRow[] = [];
  for (const row of rows) {
    if (row.dealStatus.trim() !== "") continue;
    const markers = row.note.split(" / ").map((part) => part.trim());
    if (!markers.includes(UNCERTAIN_MARKER)) continue;
    const lastAttempt = lastAttemptOf(row);
    if (!lastAttempt) continue;
    found.push({ ...row, lastAttempt });
  }
  return found;
}

import { COLUMNS, type AttemptNumber } from "../types.js";
import type { GotoErrorCategory } from "./navigation.js";
import { appendNote } from "./sheetData.js";
import { formatSheetDate, REPEATED_FAILURE_MARKER } from "./targetSelection.js";

export interface OutcomeUpdate {
  rowIndex: number;
  attemptNumber: AttemptNumber;
  outcome: "success" | "uncertain" | "failed" | "email";
  existingNote: string;
  formUrl?: string;
  failureReason?: string;
  /** 失敗の種別。一時的な失敗を何回まで再挑戦するかの判断に使う。 */
  failureCategory?: GotoErrorCategory;
  email?: string;
}

/** 開き直せば直る可能性がある失敗。これ以外は1回で打ち切る。 */
const RETRYABLE_CATEGORIES: GotoErrorCategory[] = ["timeout", "connection"];

export interface CellWrite {
  rowIndex: number;
  columnName: string;
  value: string;
}

const ATTEMPT_COLUMN: Record<AttemptNumber, string> = {
  1: COLUMNS.firstSent,
  2: COLUMNS.secondSent,
  3: COLUMNS.thirdSent,
};

/**
 * 失敗を記録した後の備考を返す。書き換え不要ならnull。
 * 同じ理由がすでにある場合、一時的な失敗なら再挑戦の上限に達したとみなして打ち切りの印に切り替え、
 * それ以外は同じ印を積み上げないよう何も書かない。
 */
function failureNote(
  existingNote: string,
  failureReason: string,
  failureCategory: GotoErrorCategory | undefined,
): string | null {
  if (!existingNote.includes(failureReason)) {
    return appendNote(existingNote, failureReason);
  }
  if (failureCategory && !RETRYABLE_CATEGORIES.includes(failureCategory)) return null;
  if (existingNote.includes(REPEATED_FAILURE_MARKER)) return null;
  return appendNote(existingNote, REPEATED_FAILURE_MARKER);
}

export function buildUpdates(update: OutcomeUpdate, today: Date): CellWrite[] {
  const writes: CellWrite[] = [];

  if (update.outcome === "success" || update.outcome === "uncertain") {
    writes.push({
      rowIndex: update.rowIndex,
      columnName: ATTEMPT_COLUMN[update.attemptNumber],
      value: formatSheetDate(today),
    });
  }

  if (update.formUrl) {
    writes.push({
      rowIndex: update.rowIndex,
      columnName: COLUMNS.formUrl,
      value: update.formUrl,
    });
  }

  if (update.outcome === "uncertain") {
    writes.push({
      rowIndex: update.rowIndex,
      columnName: COLUMNS.note,
      value: appendNote(update.existingNote, "要確認"),
    });
  } else if (update.outcome === "failed" && update.failureReason) {
    const note = failureNote(update.existingNote, update.failureReason, update.failureCategory);
    if (note !== null) {
      writes.push({ rowIndex: update.rowIndex, columnName: COLUMNS.note, value: note });
    }
  } else if (update.outcome === "email" && update.email) {
    writes.push({
      rowIndex: update.rowIndex,
      columnName: COLUMNS.email,
      value: update.email,
    });
  }

  return writes;
}

import { COLUMNS, type AttemptNumber } from "../types.js";
import { appendNote } from "./sheetData.js";
import { formatSheetDate } from "./targetSelection.js";

export interface OutcomeUpdate {
  rowIndex: number;
  attemptNumber: AttemptNumber;
  outcome: "success" | "uncertain" | "failed";
  existingNote: string;
  formUrl?: string;
  failureReason?: string;
}

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
    writes.push({
      rowIndex: update.rowIndex,
      columnName: COLUMNS.note,
      value: appendNote(update.existingNote, update.failureReason),
    });
  }

  return writes;
}

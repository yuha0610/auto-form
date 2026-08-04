import { COLUMNS, type SheetRowData } from "../types.js";
import { normalizeCellText } from "./textNormalize.js";
import { parseSheetDate } from "./targetSelection.js";

export interface SignalFields {
  signalType: string;
  signalDate: string;
  signalSourceUrl: string;
}

/** 検知シグナル関連3列のヘッダー名。スクリプト/テスト双方から共通で参照する。 */
export const SIGNAL_COLUMN_NAMES: SignalFields = {
  signalType: COLUMNS.signalType,
  signalDate: COLUMNS.signalDate,
  signalSourceUrl: COLUMNS.signalSourceUrl,
};

export interface ExistingSignalResult {
  rowIndex: number;
  companyName: string;
  signalType: string;
  signalDate: string;
  sourceUrl: string;
  confidence: "high" | "low";
  reason: string;
}

export interface SignalUpdateCandidate {
  rowIndex: number;
  companyName: string;
  before: SignalFields;
  after: SignalFields;
}

export interface SignalReviewItem {
  rowIndex: number;
  companyName: string;
  reason: string;
}

export interface SignalClassification {
  updateCandidates: SignalUpdateCandidate[];
  needsReview: SignalReviewItem[];
  unchangedCount: number;
}

function isNewerSignal(candidateDateRaw: string, currentDateRaw: string | null): boolean {
  const candidateDate = parseSheetDate(candidateDateRaw);
  if (!candidateDate) return false;
  const currentDate = parseSheetDate(currentDateRaw);
  if (!currentDate) return true;
  return candidateDate.getTime() > currentDate.getTime();
}

/** 資金調達/求人の検知結果を、シートの現在行と突き合わせて更新候補/要確認/変更なしに分類する。 */
export function classifyExistingSignals(
  results: ExistingSignalResult[],
  rows: SheetRowData[],
): SignalClassification {
  const rowByIndex = new Map(rows.map((row) => [row.rowIndex, row]));
  const updateCandidates: SignalUpdateCandidate[] = [];
  const needsReview: SignalReviewItem[] = [];
  let unchangedCount = 0;

  for (const result of results) {
    const row = rowByIndex.get(result.rowIndex);
    if (!row) {
      needsReview.push({
        rowIndex: result.rowIndex,
        companyName: result.companyName,
        reason: "シート上に該当行が見つかりません",
      });
      continue;
    }

    if (result.confidence === "low") {
      needsReview.push({ rowIndex: result.rowIndex, companyName: result.companyName, reason: result.reason });
      continue;
    }

    if (!isNewerSignal(result.signalDate, row.signalDate)) {
      unchangedCount++;
      continue;
    }

    updateCandidates.push({
      rowIndex: result.rowIndex,
      companyName: result.companyName,
      before: {
        signalType: row.signalType,
        signalDate: row.signalDate ?? "",
        signalSourceUrl: row.signalSourceUrl,
      },
      after: {
        signalType: result.signalType,
        signalDate: result.signalDate,
        signalSourceUrl: result.sourceUrl,
      },
    });
  }

  return { updateCandidates, needsReview, unchangedCount };
}

export interface StaleSkip {
  rowIndex: number;
  companyName: string;
  reason: "companyMismatch" | "valueChanged";
}

export interface SignalWritePlan {
  writes: { rowIndex: number; columnName: string; value: string }[];
  staleSkips: StaleSkip[];
}

/**
 * 書き込み直前の現在シート値と、分類時点のスナップショットである`before`を、
 * 企業名と検知シグナル3列の両方について比較し、一致するものだけ書き込み対象にする。
 */
export function buildSignalWrites(
  candidates: SignalUpdateCandidate[],
  currentRows: SheetRowData[],
  columnNames: SignalFields,
): SignalWritePlan {
  const currentByIndex = new Map(currentRows.map((row) => [row.rowIndex, row]));
  const writes: SignalWritePlan["writes"] = [];
  const staleSkips: StaleSkip[] = [];

  for (const candidate of candidates) {
    const current = currentByIndex.get(candidate.rowIndex);

    if (current === undefined) {
      staleSkips.push({ rowIndex: candidate.rowIndex, companyName: candidate.companyName, reason: "valueChanged" });
      continue;
    }

    const companyMatches =
      normalizeCellText(current.companyName) === normalizeCellText(candidate.companyName);

    if (!companyMatches) {
      staleSkips.push({ rowIndex: candidate.rowIndex, companyName: candidate.companyName, reason: "companyMismatch" });
      continue;
    }

    const valuesMatch =
      current.signalType === candidate.before.signalType &&
      (current.signalDate ?? "") === candidate.before.signalDate &&
      current.signalSourceUrl === candidate.before.signalSourceUrl;

    if (!valuesMatch) {
      staleSkips.push({ rowIndex: candidate.rowIndex, companyName: candidate.companyName, reason: "valueChanged" });
      continue;
    }

    writes.push({ rowIndex: candidate.rowIndex, columnName: columnNames.signalType, value: candidate.after.signalType });
    writes.push({ rowIndex: candidate.rowIndex, columnName: columnNames.signalDate, value: candidate.after.signalDate });
    writes.push({ rowIndex: candidate.rowIndex, columnName: columnNames.signalSourceUrl, value: candidate.after.signalSourceUrl });
  }

  return { writes, staleSkips };
}

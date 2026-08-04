import { COLUMNS, type SheetRowData } from "../types.js";
import { normalizeCellText, extractCompanyCoreName } from "./textNormalize.js";
import { parseSheetDate } from "./targetSelection.js";
import { findColumnIndex } from "./sheetData.js";
import { matchCompanyName as matchCompetitorName } from "./competitorScreening.js";
import { matchCompanyName as matchNonStartupName } from "./nonStartupScreening.js";

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

export interface NewCandidateResult {
  companyName: string;
  companyUrl: string;
  signalType: string;
  signalDate: string;
  sourceUrl: string;
  confidence: "high" | "low";
  reason: string;
}

export interface NewCompanyRow {
  companyName: string;
  companyUrl: string;
  signalType: string;
  signalDate: string;
  signalSourceUrl: string;
}

export interface NewRowReviewItem {
  companyName: string;
  reason: string;
}

export interface NewCandidateClassification {
  provisionalRows: NewCompanyRow[];
  needsReview: NewRowReviewItem[];
}

/**
 * 資金調達/求人で新規発掘した企業を、confidence・既存シートとの重複(企業名の表記ゆれ含む)・
 * 競合/非スタートアップの企業名キーワードで判定する。
 * ページ内容によるキーワード判定はI/O(URL取得)を伴うためこの関数の対象外とし、
 * 呼び出し側(scripts/applySignals.ts)で`provisionalRows`に対して別途行う。
 */
export function classifyNewCandidates(
  candidates: NewCandidateResult[],
  existingRows: SheetRowData[],
): NewCandidateClassification {
  const existingCoreNames = new Set(
    existingRows.map((row) => extractCompanyCoreName(row.companyName)).filter((name) => name !== ""),
  );

  const provisionalRows: NewCompanyRow[] = [];
  const needsReview: NewRowReviewItem[] = [];

  for (const candidate of candidates) {
    if (candidate.confidence === "low") {
      needsReview.push({ companyName: candidate.companyName, reason: candidate.reason });
      continue;
    }

    const coreName = extractCompanyCoreName(candidate.companyName);
    if (coreName !== "" && existingCoreNames.has(coreName)) {
      needsReview.push({ companyName: candidate.companyName, reason: "既存シートに同名企業が存在" });
      continue;
    }

    const competitorMatch = matchCompetitorName(candidate.companyName);
    if (competitorMatch) {
      needsReview.push({ companyName: candidate.companyName, reason: `企業名に「${competitorMatch}」(競合)` });
      continue;
    }

    const nonStartupMatch = matchNonStartupName(candidate.companyName);
    if (nonStartupMatch) {
      needsReview.push({ companyName: candidate.companyName, reason: `企業名に「${nonStartupMatch}」(非スタートアップ)` });
      continue;
    }

    provisionalRows.push({
      companyName: candidate.companyName,
      companyUrl: candidate.companyUrl,
      signalType: candidate.signalType,
      signalDate: candidate.signalDate,
      signalSourceUrl: candidate.sourceUrl,
    });
  }

  return { provisionalRows, needsReview };
}

/** ヘッダー順に合わせて新規行の値配列を組み立てる(該当しない列は空文字)。 */
export function buildNewRowValues(row: NewCompanyRow, headerRow: string[]): string[] {
  const values = new Array(headerRow.length).fill("");
  values[findColumnIndex(headerRow, COLUMNS.companyName)] = row.companyName;
  values[findColumnIndex(headerRow, COLUMNS.companyUrl)] = row.companyUrl;
  values[findColumnIndex(headerRow, COLUMNS.signalType)] = row.signalType;
  values[findColumnIndex(headerRow, COLUMNS.signalDate)] = row.signalDate;
  values[findColumnIndex(headerRow, COLUMNS.signalSourceUrl)] = row.signalSourceUrl;
  return values;
}

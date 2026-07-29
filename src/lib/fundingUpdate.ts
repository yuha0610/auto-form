import { COLUMNS, type SheetRowData } from "../types.js";
import { normalizeCellText } from "./textNormalize.js";

export interface FundingFields {
  fundingAmount: string;
  fundingRound: string;
  fundingMonth: string;
  prTimesUrl: string;
}

/** 資金調達関連4列のヘッダー名。スクリプト/テスト双方から共通で参照する。 */
export const FUNDING_COLUMN_NAMES: FundingFields = {
  fundingAmount: COLUMNS.fundingAmount,
  fundingRound: COLUMNS.fundingRound,
  fundingMonth: COLUMNS.fundingMonth,
  prTimesUrl: COLUMNS.prTimesUrl,
};

export interface FundingResearchResult {
  rowIndex: number;
  companyName: string;
  found: boolean;
  updateCandidate: boolean;
  /** 調査時点でシート上にあった資金調達関連4列の値。beforeスナップショットの正式なソース。 */
  existing: FundingFields;
  fundingAmount?: string;
  fundingRound?: string;
  fundingMonth?: string;
  sourceUrl?: string;
  confidence: "high" | "low";
  reason: string;
}

export interface FundingUpdateCandidate {
  rowIndex: number;
  companyName: string;
  before: FundingFields;
  after: FundingFields;
}

export interface FundingReviewItem {
  rowIndex: number;
  companyName: string;
  reason: string;
}

export interface FundingClassification {
  updateCandidates: FundingUpdateCandidate[];
  needsReview: FundingReviewItem[];
  unchangedCount: number;
}

export interface StaleSkip {
  rowIndex: number;
  companyName: string;
  reason: "companyMismatch" | "valueChanged";
}

export interface FundingWritePlan {
  writes: { rowIndex: number; columnName: string; value: string }[];
  staleSkips: StaleSkip[];
}

/** 値が空白のみでなければそのまま採用し、空白のみ/未指定ならfallbackを使う。 */
function pick(candidate: string | undefined, fallback: string): string {
  return candidate && candidate.trim() ? candidate : fallback;
}

/** JSON調査結果と現在のシート行を突き合わせ、更新候補/要目視確認/変更なしに分類する。 */
export function classifyFundingResults(
  results: FundingResearchResult[],
  rows: SheetRowData[],
): FundingClassification {
  const rowByIndex = new Map(rows.map((row) => [row.rowIndex, row]));
  const updateCandidates: FundingUpdateCandidate[] = [];
  const needsReview: FundingReviewItem[] = [];
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

    if (!result.updateCandidate) {
      unchangedCount++;
      continue;
    }

    updateCandidates.push({
      rowIndex: result.rowIndex,
      companyName: result.companyName,
      before: {
        fundingAmount: result.existing.fundingAmount,
        fundingRound: result.existing.fundingRound,
        fundingMonth: result.existing.fundingMonth,
        prTimesUrl: result.existing.prTimesUrl,
      },
      after: {
        fundingAmount: pick(result.fundingAmount, result.existing.fundingAmount),
        fundingRound: pick(result.fundingRound, result.existing.fundingRound),
        fundingMonth: pick(result.fundingMonth, result.existing.fundingMonth),
        prTimesUrl: pick(result.sourceUrl, result.existing.prTimesUrl),
      },
    });
  }

  return { updateCandidates, needsReview, unchangedCount };
}

/**
 * 書き込み直前の現在シート値と、調査結果生成時点(=シート取得時点)のスナップショットである
 * `before`を、企業名と資金調達4列の両方について比較し、一致するものだけ書き込み対象にする。
 * 行がシート上から消えている・企業名が一致しない(行のズレ)・値が変わっている(手動編集済み)
 * のいずれかに該当する場合は誤上書きを避けるためスキップする。
 */
export function buildFundingWrites(
  candidates: FundingUpdateCandidate[],
  currentRows: SheetRowData[],
  columnNames: FundingFields,
): FundingWritePlan {
  const currentByIndex = new Map(currentRows.map((row) => [row.rowIndex, row]));
  const writes: FundingWritePlan["writes"] = [];
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
      current.fundingAmount === candidate.before.fundingAmount &&
      current.fundingRound === candidate.before.fundingRound &&
      current.fundingMonth === candidate.before.fundingMonth &&
      current.prTimesUrl === candidate.before.prTimesUrl;

    if (!valuesMatch) {
      staleSkips.push({ rowIndex: candidate.rowIndex, companyName: candidate.companyName, reason: "valueChanged" });
      continue;
    }

    writes.push({ rowIndex: candidate.rowIndex, columnName: columnNames.fundingAmount, value: candidate.after.fundingAmount });
    writes.push({ rowIndex: candidate.rowIndex, columnName: columnNames.fundingRound, value: candidate.after.fundingRound });
    writes.push({ rowIndex: candidate.rowIndex, columnName: columnNames.fundingMonth, value: candidate.after.fundingMonth });
    writes.push({ rowIndex: candidate.rowIndex, columnName: columnNames.prTimesUrl, value: candidate.after.prTimesUrl });
  }

  return { writes, staleSkips };
}

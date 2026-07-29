import type { SheetRowData } from "../types.js";

export interface FundingResearchResult {
  rowIndex: number;
  companyName: string;
  found: boolean;
  updateCandidate: boolean;
  fundingAmount?: string;
  fundingRound?: string;
  fundingMonth?: string;
  sourceUrl?: string;
  confidence: "high" | "low";
  reason: string;
}

export interface FundingFields {
  fundingAmount: string;
  fundingRound: string;
  fundingMonth: string;
  prTimesUrl: string;
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
}

export interface FundingWritePlan {
  writes: { rowIndex: number; columnName: string; value: string }[];
  staleSkips: StaleSkip[];
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
        fundingAmount: row.fundingAmount,
        fundingRound: row.fundingRound,
        fundingMonth: row.fundingMonth,
        prTimesUrl: row.prTimesUrl,
      },
      after: {
        fundingAmount: result.fundingAmount ?? row.fundingAmount,
        fundingRound: result.fundingRound ?? row.fundingRound,
        fundingMonth: result.fundingMonth ?? row.fundingMonth,
        prTimesUrl: result.sourceUrl ?? row.prTimesUrl,
      },
    });
  }

  return { updateCandidates, needsReview, unchangedCount };
}

/**
 * 書き込み直前の現在シート値と、調査結果生成時点の`before`を比較し、
 * 一致するものだけ書き込み対象にする(手動編集済みの行は誤上書きを避けるためスキップする)。
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
    const stillMatches =
      current !== undefined &&
      current.fundingAmount === candidate.before.fundingAmount &&
      current.fundingRound === candidate.before.fundingRound &&
      current.fundingMonth === candidate.before.fundingMonth &&
      current.prTimesUrl === candidate.before.prTimesUrl;

    if (!stillMatches) {
      staleSkips.push({ rowIndex: candidate.rowIndex, companyName: candidate.companyName });
      continue;
    }

    writes.push({ rowIndex: candidate.rowIndex, columnName: columnNames.fundingAmount, value: candidate.after.fundingAmount });
    writes.push({ rowIndex: candidate.rowIndex, columnName: columnNames.fundingRound, value: candidate.after.fundingRound });
    writes.push({ rowIndex: candidate.rowIndex, columnName: columnNames.fundingMonth, value: candidate.after.fundingMonth });
    writes.push({ rowIndex: candidate.rowIndex, columnName: columnNames.prTimesUrl, value: candidate.after.prTimesUrl });
  }

  return { writes, staleSkips };
}

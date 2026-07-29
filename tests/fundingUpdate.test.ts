import { test, expect } from "@playwright/test";
import {
  classifyFundingResults,
  buildFundingWrites,
  FUNDING_COLUMN_NAMES,
  type FundingResearchResult,
} from "../src/lib/fundingUpdate.js";
import { COLUMNS } from "../src/types.js";
import type { SheetRowData } from "../src/types.js";

function makeRow(overrides: Partial<SheetRowData> = {}): SheetRowData {
  return {
    rowIndex: 2,
    companyName: "サンプル株式会社",
    companyUrl: "https://example.com/",
    formUrl: "",
    note: "",
    dealStatus: "",
    firstSentAt: null,
    secondSentAt: null,
    thirdSentAt: null,
    email: "",
    fundingAmount: "1億円",
    fundingRound: "シードラウンド",
    fundingMonth: "2025-01",
    prTimesUrl: "https://prtimes.jp/old",
    ...overrides,
  };
}

const EXISTING_FIELDS = {
  fundingAmount: "1億円",
  fundingRound: "シードラウンド",
  fundingMonth: "2025-01",
  prTimesUrl: "https://prtimes.jp/old",
};

test("classifyFundingResults: high確信度かつupdateCandidateは更新候補に分類される", () => {
  const rows = [makeRow()];
  const results: FundingResearchResult[] = [
    {
      rowIndex: 2,
      companyName: "サンプル株式会社",
      found: true,
      updateCandidate: true,
      existing: EXISTING_FIELDS,
      fundingAmount: "5億円",
      fundingRound: "シリーズB",
      fundingMonth: "2026-06",
      sourceUrl: "https://prtimes.jp/new",
      confidence: "high",
      reason: "PR TIMESとNewsPicksの2ソースで一致",
    },
  ];

  const { updateCandidates, needsReview, unchangedCount } = classifyFundingResults(results, rows);

  expect(updateCandidates).toEqual([
    {
      rowIndex: 2,
      companyName: "サンプル株式会社",
      before: { fundingAmount: "1億円", fundingRound: "シードラウンド", fundingMonth: "2025-01", prTimesUrl: "https://prtimes.jp/old" },
      after: { fundingAmount: "5億円", fundingRound: "シリーズB", fundingMonth: "2026-06", prTimesUrl: "https://prtimes.jp/new" },
    },
  ]);
  expect(needsReview).toEqual([]);
  expect(unchangedCount).toBe(0);
});

test("classifyFundingResults: confidenceがlowなら要目視確認に回す", () => {
  const rows = [makeRow()];
  const results: FundingResearchResult[] = [
    {
      rowIndex: 2,
      companyName: "サンプル株式会社",
      found: true,
      updateCandidate: false,
      existing: EXISTING_FIELDS,
      confidence: "low",
      reason: "ソースが1件のみで確信が持てない",
    },
  ];

  const { updateCandidates, needsReview, unchangedCount } = classifyFundingResults(results, rows);

  expect(updateCandidates).toEqual([]);
  expect(needsReview).toEqual([
    { rowIndex: 2, companyName: "サンプル株式会社", reason: "ソースが1件のみで確信が持てない" },
  ]);
  expect(unchangedCount).toBe(0);
});

test("classifyFundingResults: updateCandidateがfalseかつhigh確信度は変更なしカウントに入る", () => {
  const rows = [makeRow()];
  const results: FundingResearchResult[] = [
    {
      rowIndex: 2,
      companyName: "サンプル株式会社",
      found: true,
      updateCandidate: false,
      existing: EXISTING_FIELDS,
      confidence: "high",
      reason: "既存値と同じ最新ラウンドを確認",
    },
  ];

  const { updateCandidates, needsReview, unchangedCount } = classifyFundingResults(results, rows);

  expect(updateCandidates).toEqual([]);
  expect(needsReview).toEqual([]);
  expect(unchangedCount).toBe(1);
});

test("classifyFundingResults: シート上に該当行が無い結果は要目視確認に回す", () => {
  const rows = [makeRow({ rowIndex: 2 })];
  const results: FundingResearchResult[] = [
    {
      rowIndex: 999,
      companyName: "消えた株式会社",
      found: true,
      updateCandidate: true,
      existing: EXISTING_FIELDS,
      confidence: "high",
      reason: "調べたが該当行なし",
    },
  ];

  const { needsReview } = classifyFundingResults(results, rows);

  expect(needsReview).toEqual([
    { rowIndex: 999, companyName: "消えた株式会社", reason: "シート上に該当行が見つかりません" },
  ]);
});

test("buildFundingWrites: 現在値がbeforeと一致すれば4列分の書き込みを生成する", () => {
  const candidates = [
    {
      rowIndex: 2,
      companyName: "サンプル株式会社",
      before: { fundingAmount: "1億円", fundingRound: "シードラウンド", fundingMonth: "2025-01", prTimesUrl: "https://prtimes.jp/old" },
      after: { fundingAmount: "5億円", fundingRound: "シリーズB", fundingMonth: "2026-06", prTimesUrl: "https://prtimes.jp/new" },
    },
  ];
  const currentRows = [makeRow({ rowIndex: 2 })];

  const { writes, staleSkips } = buildFundingWrites(candidates, currentRows, FUNDING_COLUMN_NAMES);

  expect(staleSkips).toEqual([]);
  expect(writes).toEqual([
    { rowIndex: 2, columnName: COLUMNS.fundingAmount, value: "5億円" },
    { rowIndex: 2, columnName: COLUMNS.fundingRound, value: "シリーズB" },
    { rowIndex: 2, columnName: COLUMNS.fundingMonth, value: "2026-06" },
    { rowIndex: 2, columnName: COLUMNS.prTimesUrl, value: "https://prtimes.jp/new" },
  ]);
});

test("buildFundingWrites: 現在値がbeforeと異なる(手動編集済み)行はスキップされる", () => {
  const candidates = [
    {
      rowIndex: 2,
      companyName: "サンプル株式会社",
      before: { fundingAmount: "1億円", fundingRound: "シードラウンド", fundingMonth: "2025-01", prTimesUrl: "https://prtimes.jp/old" },
      after: { fundingAmount: "5億円", fundingRound: "シリーズB", fundingMonth: "2026-06", prTimesUrl: "https://prtimes.jp/new" },
    },
  ];
  const currentRows = [makeRow({ rowIndex: 2, fundingAmount: "2億円" })];

  const { writes, staleSkips } = buildFundingWrites(candidates, currentRows, FUNDING_COLUMN_NAMES);

  expect(writes).toEqual([]);
  expect(staleSkips).toEqual([{ rowIndex: 2, companyName: "サンプル株式会社", reason: "valueChanged" }]);
});

test("classifyFundingResults→buildFundingWrites: 行がズレて企業名が一致しない場合は書き込みをスキップする", () => {
  const rows = [makeRow({ rowIndex: 2, companyName: "サンプル株式会社" })];
  const results: FundingResearchResult[] = [
    {
      rowIndex: 2,
      companyName: "サンプル株式会社",
      found: true,
      updateCandidate: true,
      existing: EXISTING_FIELDS,
      fundingAmount: "5億円",
      fundingRound: "シリーズB",
      fundingMonth: "2026-06",
      sourceUrl: "https://prtimes.jp/new",
      confidence: "high",
      reason: "PR TIMESとNewsPicksの2ソースで一致",
    },
  ];

  const { updateCandidates } = classifyFundingResults(results, rows);

  // 書き込み直前に再取得した「現在の」シートでは、同じrowIndexだが別の会社の行になっている
  // (行の挿入/削除/ソートで行がズレたことを想定)
  const currentRows = [makeRow({ rowIndex: 2, companyName: "別の株式会社" })];

  const { writes, staleSkips } = buildFundingWrites(updateCandidates, currentRows, FUNDING_COLUMN_NAMES);

  expect(writes).toEqual([]);
  expect(staleSkips).toEqual([
    { rowIndex: 2, companyName: "サンプル株式会社", reason: "companyMismatch" },
  ]);
});

test("classifyFundingResults: sourceUrlが空文字の場合はafterで既存のprTimesUrlを上書きしない", () => {
  const rows = [makeRow()];
  const results: FundingResearchResult[] = [
    {
      rowIndex: 2,
      companyName: "サンプル株式会社",
      found: true,
      updateCandidate: true,
      existing: EXISTING_FIELDS,
      fundingAmount: "5億円",
      fundingRound: "シリーズB",
      fundingMonth: "2026-06",
      sourceUrl: "",
      confidence: "high",
      reason: "金額とラウンドは確認できたが新しいソースURLはなし",
    },
  ];

  const { updateCandidates } = classifyFundingResults(results, rows);

  expect(updateCandidates[0].after.prTimesUrl).toBe("https://prtimes.jp/old");
});

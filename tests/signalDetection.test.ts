import { test, expect } from "@playwright/test";
import {
  classifyExistingSignals,
  buildSignalWrites,
  SIGNAL_COLUMN_NAMES,
  type ExistingSignalResult,
} from "../src/lib/signalDetection.js";
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
    fundingAmount: "",
    fundingRound: "",
    fundingMonth: "",
    prTimesUrl: "",
    signalType: "",
    signalDate: null,
    signalSourceUrl: "",
    ...overrides,
  };
}

test("classifyExistingSignals: 検知日がシート上の値より新しければ更新候補になる", () => {
  const rows = [makeRow({ signalDate: "2026/07/01", signalType: "求人", signalSourceUrl: "https://old.example.com" })];
  const results: ExistingSignalResult[] = [
    {
      rowIndex: 2,
      companyName: "サンプル株式会社",
      signalType: "資金調達",
      signalDate: "2026/08/01",
      sourceUrl: "https://prtimes.jp/new",
      confidence: "high",
      reason: "PR TIMESで確認",
    },
  ];

  const { updateCandidates, needsReview, unchangedCount } = classifyExistingSignals(results, rows);

  expect(updateCandidates).toEqual([
    {
      rowIndex: 2,
      companyName: "サンプル株式会社",
      before: { signalType: "求人", signalDate: "2026/07/01", signalSourceUrl: "https://old.example.com" },
      after: { signalType: "資金調達", signalDate: "2026/08/01", signalSourceUrl: "https://prtimes.jp/new" },
    },
  ]);
  expect(needsReview).toEqual([]);
  expect(unchangedCount).toBe(0);
});

test("classifyExistingSignals: 検知日がシート上の値と同じかそれより古い場合は変更なしに分類される", () => {
  const rows = [makeRow({ signalDate: "2026/08/01" })];
  const results: ExistingSignalResult[] = [
    {
      rowIndex: 2,
      companyName: "サンプル株式会社",
      signalType: "資金調達",
      signalDate: "2026/08/01",
      sourceUrl: "https://prtimes.jp/new",
      confidence: "high",
      reason: "同じ検知結果",
    },
  ];

  const { updateCandidates, unchangedCount } = classifyExistingSignals(results, rows);

  expect(updateCandidates).toEqual([]);
  expect(unchangedCount).toBe(1);
});

test("classifyExistingSignals: confidenceがlowなら要確認に回す", () => {
  const rows = [makeRow()];
  const results: ExistingSignalResult[] = [
    {
      rowIndex: 2,
      companyName: "サンプル株式会社",
      signalType: "求人",
      signalDate: "2026/08/01",
      sourceUrl: "https://example.com/jobs",
      confidence: "low",
      reason: "求人媒体1件のみで確信が持てない",
    },
  ];

  const { updateCandidates, needsReview } = classifyExistingSignals(results, rows);

  expect(updateCandidates).toEqual([]);
  expect(needsReview).toEqual([
    { rowIndex: 2, companyName: "サンプル株式会社", reason: "求人媒体1件のみで確信が持てない" },
  ]);
});

test("classifyExistingSignals: シート上に該当行が無い結果は要確認に回す", () => {
  const rows = [makeRow({ rowIndex: 2 })];
  const results: ExistingSignalResult[] = [
    {
      rowIndex: 999,
      companyName: "消えた株式会社",
      signalType: "資金調達",
      signalDate: "2026/08/01",
      sourceUrl: "https://prtimes.jp/x",
      confidence: "high",
      reason: "調べたが該当行なし",
    },
  ];

  const { needsReview } = classifyExistingSignals(results, rows);

  expect(needsReview).toEqual([
    { rowIndex: 999, companyName: "消えた株式会社", reason: "シート上に該当行が見つかりません" },
  ]);
});

test("buildSignalWrites: 現在値がbeforeと一致すれば3列分の書き込みを生成する", () => {
  const candidates = [
    {
      rowIndex: 2,
      companyName: "サンプル株式会社",
      before: { signalType: "求人", signalDate: "2026/07/01", signalSourceUrl: "https://old.example.com" },
      after: { signalType: "資金調達", signalDate: "2026/08/01", signalSourceUrl: "https://prtimes.jp/new" },
    },
  ];
  const currentRows = [
    makeRow({ rowIndex: 2, signalType: "求人", signalDate: "2026/07/01", signalSourceUrl: "https://old.example.com" }),
  ];

  const { writes, staleSkips } = buildSignalWrites(candidates, currentRows, SIGNAL_COLUMN_NAMES);

  expect(staleSkips).toEqual([]);
  expect(writes).toEqual([
    { rowIndex: 2, columnName: COLUMNS.signalType, value: "資金調達" },
    { rowIndex: 2, columnName: COLUMNS.signalDate, value: "2026/08/01" },
    { rowIndex: 2, columnName: COLUMNS.signalSourceUrl, value: "https://prtimes.jp/new" },
  ]);
});

test("buildSignalWrites: 現在値がbeforeと異なる(手動編集済み)行はスキップされる", () => {
  const candidates = [
    {
      rowIndex: 2,
      companyName: "サンプル株式会社",
      before: { signalType: "求人", signalDate: "2026/07/01", signalSourceUrl: "https://old.example.com" },
      after: { signalType: "資金調達", signalDate: "2026/08/01", signalSourceUrl: "https://prtimes.jp/new" },
    },
  ];
  const currentRows = [
    makeRow({ rowIndex: 2, signalType: "求人", signalDate: "2026/07/20", signalSourceUrl: "https://old.example.com" }),
  ];

  const { writes, staleSkips } = buildSignalWrites(candidates, currentRows, SIGNAL_COLUMN_NAMES);

  expect(writes).toEqual([]);
  expect(staleSkips).toEqual([{ rowIndex: 2, companyName: "サンプル株式会社", reason: "valueChanged" }]);
});

test("buildSignalWrites: 行がズレて企業名が一致しない場合は書き込みをスキップする", () => {
  const candidates = [
    {
      rowIndex: 2,
      companyName: "サンプル株式会社",
      before: { signalType: "", signalDate: "", signalSourceUrl: "" },
      after: { signalType: "資金調達", signalDate: "2026/08/01", signalSourceUrl: "https://prtimes.jp/new" },
    },
  ];
  const currentRows = [makeRow({ rowIndex: 2, companyName: "別の株式会社" })];

  const { writes, staleSkips } = buildSignalWrites(candidates, currentRows, SIGNAL_COLUMN_NAMES);

  expect(writes).toEqual([]);
  expect(staleSkips).toEqual([{ rowIndex: 2, companyName: "サンプル株式会社", reason: "companyMismatch" }]);
});

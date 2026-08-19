import { test, expect } from "@playwright/test";
import { toSheetDate, matchSweepEvents, type SweepEvent } from "../src/lib/signalSweepMatch.js";
import type { SheetRowData } from "../src/types.js";

function makeRow(overrides: Partial<SheetRowData>): SheetRowData {
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

function makeEvent(overrides: Partial<SweepEvent>): SweepEvent {
  return {
    companyName: "株式会社テスト",
    companyUrl: "https://test.example.com/",
    amount: "3億円",
    round: "シリーズA",
    announcedDate: "2026-08-05",
    sourceUrl: "https://prtimes.jp/main/html/rd/p/000000001.000000001.html",
    confidence: "high",
    ...overrides,
  };
}

test("toSheetDate: YYYY-MM-DD をシート形式の YYYY/MM/DD に変換する", () => {
  expect(toSheetDate("2026-08-05")).toBe("2026/08/05");
});

test("toSheetDate: 日付として解釈できない文字列にはnullを返す", () => {
  expect(toSheetDate("")).toBeNull();
  expect(toSheetDate("2026年8月5日")).toBeNull();
  expect(toSheetDate("2026-08")).toBeNull();
});

test("matchSweepEvents: 企業名がシートの行と一致すればexistingSignalsに入る", () => {
  const rows = [makeRow({ rowIndex: 7, companyName: "株式会社テスト" })];
  const result = matchSweepEvents([makeEvent({})], rows);

  expect(result.newCandidates).toEqual([]);
  expect(result.existingSignals).toHaveLength(1);
  expect(result.existingSignals[0].rowIndex).toBe(7);
  expect(result.existingSignals[0].signalType).toBe("資金調達");
  expect(result.existingSignals[0].signalDate).toBe("2026/08/05");
});

test("matchSweepEvents: existingSignalsの企業名はシート側の表記を使う(書き込み直前の照合を通すため)", () => {
  const rows = [makeRow({ rowIndex: 7, companyName: "テスト株式会社" })];
  const result = matchSweepEvents([makeEvent({ companyName: "株式会社テスト" })], rows);

  expect(result.existingSignals).toHaveLength(1);
  expect(result.existingSignals[0].companyName).toBe("テスト株式会社");
});

test("matchSweepEvents: シートに無い企業はnewCandidatesに入る", () => {
  const rows = [makeRow({ rowIndex: 2, companyName: "全然違う株式会社" })];
  const result = matchSweepEvents([makeEvent({ companyName: "株式会社テスト" })], rows);

  expect(result.existingSignals).toEqual([]);
  expect(result.newCandidates).toHaveLength(1);
  expect(result.newCandidates[0].companyName).toBe("株式会社テスト");
  expect(result.newCandidates[0].companyUrl).toBe("https://test.example.com/");
});

test("matchSweepEvents: 日付が解釈できないイベントはskippedに入れ、両方の結果に含めない", () => {
  const rows = [makeRow({ rowIndex: 7, companyName: "株式会社テスト" })];
  const result = matchSweepEvents([makeEvent({ announcedDate: "2026年8月" })], rows);

  expect(result.existingSignals).toEqual([]);
  expect(result.newCandidates).toEqual([]);
  expect(result.skipped).toHaveLength(1);
});

test("matchSweepEvents: reasonに調達額とラウンドを含める(目視確認時の判断材料にするため)", () => {
  const rows = [makeRow({ rowIndex: 7, companyName: "株式会社テスト" })];
  const result = matchSweepEvents([makeEvent({ amount: "3億円", round: "シリーズA" })], rows);

  expect(result.existingSignals[0].reason).toContain("3億円");
  expect(result.existingSignals[0].reason).toContain("シリーズA");
});

test("matchSweepEvents: confidenceはイベントの値をそのまま引き継ぐ", () => {
  const rows = [makeRow({ rowIndex: 7, companyName: "株式会社テスト" })];
  const result = matchSweepEvents([makeEvent({ confidence: "low" })], rows);

  expect(result.existingSignals[0].confidence).toBe("low");
});

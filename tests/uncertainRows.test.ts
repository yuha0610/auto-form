import { test, expect } from "@playwright/test";
import { selectUncertainRows } from "../src/lib/uncertainRows.js";
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
    signalType: "",
    signalDate: null,
    signalSourceUrl: "",
    ...overrides,
  };
}

test("送信日が入っていて「要確認」が付いている行を拾う", () => {
  const row = makeRow({ note: "要確認", firstSentAt: "2026/07/13" });
  expect(selectUncertainRows([row]).map((r) => r.rowIndex)).toEqual([2]);
});

test("送信日が1つも無い行は拾わない(まだ送っていないだけなので)", () => {
  const row = makeRow({ note: "要確認" });
  expect(selectUncertainRows([row])).toEqual([]);
});

test("「読み込み失敗(要確認)」など別の印は拾わない", () => {
  const row = makeRow({ note: "読み込み失敗(要確認)", firstSentAt: "2026/07/13" });
  expect(selectUncertainRows([row])).toEqual([]);
});

test("商談が決まっている行は見直す必要がないので拾わない", () => {
  const row = makeRow({ note: "要確認", firstSentAt: "2026/07/13", dealStatus: "2026/08/01" });
  expect(selectUncertainRows([row])).toEqual([]);
});

test("最後に送信日が入った回を、確認が必要な回として示す", () => {
  const row = makeRow({
    note: "要確認",
    firstSentAt: "2026/07/13",
    secondSentAt: "2026/08/07",
  });
  expect(selectUncertainRows([row])[0].lastAttempt).toEqual({ number: 2, sentAt: "2026/08/07" });
});

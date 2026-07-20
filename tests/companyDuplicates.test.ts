import { test, expect } from "@playwright/test";
import { groupByCoreName, choosePrimaryRow } from "../src/lib/companyDuplicates.js";
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
    ...overrides,
  };
}

test("groupByCoreName: コア名が一致する行をグループ化する", () => {
  const rows = [
    makeRow({ rowIndex: 2, companyName: "Luup" }),
    makeRow({ rowIndex: 3, companyName: "株式会社Luup" }),
    makeRow({ rowIndex: 4, companyName: "全く別の会社" }),
  ];

  const groups = groupByCoreName(rows);

  expect(groups).toHaveLength(1);
  expect(groups[0].coreName).toBe("luup");
  expect(groups[0].rows.map((r) => r.rowIndex)).toEqual([2, 3]);
});

test("groupByCoreName: 単独行(重複していない)はグループに含めない", () => {
  const rows = [makeRow({ rowIndex: 2, companyName: "ユニークな会社" })];

  expect(groupByCoreName(rows)).toHaveLength(0);
});

test("groupByCoreName: 企業名が空の行は無視する", () => {
  const rows = [
    makeRow({ rowIndex: 2, companyName: "" }),
    makeRow({ rowIndex: 3, companyName: "" }),
  ];

  expect(groupByCoreName(rows)).toHaveLength(0);
});

test("choosePrimaryRow: 商談確定日がある行を最優先で残す", () => {
  const rows = [
    makeRow({ rowIndex: 2, dealStatus: "", thirdSentAt: "2026/01/01" }),
    makeRow({ rowIndex: 3, dealStatus: "2026/07/21", firstSentAt: "2026/01/01" }),
  ];

  const { primary, discarded } = choosePrimaryRow(rows);

  expect(primary.rowIndex).toBe(3);
  expect(discarded.map((r) => r.rowIndex)).toEqual([2]);
});

test("choosePrimaryRow: 商談確定日が無ければ送信回数が多い行を残す", () => {
  const rows = [
    makeRow({ rowIndex: 2, firstSentAt: "2026/01/01" }),
    makeRow({ rowIndex: 3, firstSentAt: "2026/01/01", secondSentAt: "2026/02/01" }),
  ];

  const { primary, discarded } = choosePrimaryRow(rows);

  expect(primary.rowIndex).toBe(3);
  expect(discarded.map((r) => r.rowIndex)).toEqual([2]);
});

test("choosePrimaryRow: 優先度が同点なら元の行順で先頭を残す", () => {
  const rows = [
    makeRow({ rowIndex: 2 }),
    makeRow({ rowIndex: 3 }),
  ];

  const { primary, discarded } = choosePrimaryRow(rows);

  expect(primary.rowIndex).toBe(2);
  expect(discarded.map((r) => r.rowIndex)).toEqual([3]);
});

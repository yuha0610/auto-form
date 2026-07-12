import { test, expect } from "@playwright/test";
import {
  parseSheetRows,
  columnIndexToLetter,
  appendNote,
  findColumnIndex,
} from "../src/lib/sheetData.js";
import { COLUMNS } from "../src/types.js";

test("columnIndexToLetter: 0はA, 25はZ, 26はAA", () => {
  expect(columnIndexToLetter(0)).toBe("A");
  expect(columnIndexToLetter(25)).toBe("Z");
  expect(columnIndexToLetter(26)).toBe("AA");
});

test("appendNote: 既存が空なら追加文字列だけになる", () => {
  expect(appendNote("", "要確認")).toBe("要確認");
});

test("appendNote: 既存があれば ' / ' で連結する", () => {
  expect(appendNote("メール", "要確認")).toBe("メール / 要確認");
});

test("parseSheetRows: ヘッダー名から列を引いてSheetRowDataに変換する", () => {
  const headerRow = [
    COLUMNS.companyName,
    COLUMNS.companyUrl,
    COLUMNS.formUrl,
    COLUMNS.note,
    COLUMNS.dealStatus,
    COLUMNS.firstSent,
    COLUMNS.secondSent,
    COLUMNS.thirdSent,
  ];
  const dataRows = [
    ["サンプル株式会社", "https://example.com/", "", "フォーム無", "無", "", "", ""],
  ];
  const rows = parseSheetRows({ headerRow, dataRows });
  expect(rows).toEqual([
    {
      rowIndex: 2,
      companyName: "サンプル株式会社",
      companyUrl: "https://example.com/",
      formUrl: "",
      note: "フォーム無",
      dealStatus: "無",
      firstSentAt: null,
      secondSentAt: null,
      thirdSentAt: null,
    },
  ]);
});

test("parseSheetRows: 列名が見つからない場合はエラーを投げる", () => {
  expect(() => parseSheetRows({ headerRow: ["何か"], dataRows: [] })).toThrow(
    /企業名/,
  );
});

test("findColumnIndex: ヘッダーが改行入りでもCOLUMNSのスペース区切り名で見つかる", () => {
  const headerRow = ["企業名", "商談\n確定日", "フォーム営業\n1回目"];
  expect(findColumnIndex(headerRow, COLUMNS.dealStatus)).toBe(1);
  expect(findColumnIndex(headerRow, COLUMNS.firstSent)).toBe(2);
});

test("findColumnIndex: 連続する空白（スペース・タブ・改行混在）は1つのスペースに正規化される", () => {
  const headerRow = ["企業名", "商談   確定日", "フォーム営業\t\n1回目"];
  expect(findColumnIndex(headerRow, COLUMNS.dealStatus)).toBe(1);
  expect(findColumnIndex(headerRow, COLUMNS.firstSent)).toBe(2);
});

test("findColumnIndex: ヘッダーの前後の空白（改行含む）は無視される", () => {
  const headerRow = ["  企業名  ", "\n商談 確定日\n"];
  expect(findColumnIndex(headerRow, COLUMNS.companyName)).toBe(0);
  expect(findColumnIndex(headerRow, COLUMNS.dealStatus)).toBe(1);
});

test("findColumnIndex: 完全一致する列がなければエラーを投げる（空白正規化しても別物）", () => {
  expect(() => findColumnIndex(["企業名", "備考"], COLUMNS.dealStatus)).toThrow(
    /商談 確定日/,
  );
});

test("parseSheetRows: 実シートのように改行入りヘッダーでも正しくパースできる", () => {
  const headerRow = [
    COLUMNS.companyName,
    COLUMNS.companyUrl,
    COLUMNS.formUrl,
    COLUMNS.note,
    "商談\n確定日",
    "フォーム営業\n1回目",
    COLUMNS.secondSent,
    COLUMNS.thirdSent,
  ];
  const dataRows = [
    ["サンプル株式会社", "https://example.com/", "", "フォーム無", "無", "2026-07-01", "", ""],
  ];
  const rows = parseSheetRows({ headerRow, dataRows });
  expect(rows).toEqual([
    {
      rowIndex: 2,
      companyName: "サンプル株式会社",
      companyUrl: "https://example.com/",
      formUrl: "",
      note: "フォーム無",
      dealStatus: "無",
      firstSentAt: "2026-07-01",
      secondSentAt: null,
      thirdSentAt: null,
    },
  ]);
});

import { test, expect } from "@playwright/test";
import { parseSheetRows, columnIndexToLetter, appendNote } from "../src/lib/sheetData.js";
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

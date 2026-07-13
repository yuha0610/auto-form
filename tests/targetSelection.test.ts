import { test, expect } from "@playwright/test";
import {
  parseSheetDate,
  formatSheetDate,
  isSkipped,
  getNextAttempt,
  selectBatch,
  dedupeByCompanyName,
} from "../src/lib/targetSelection.js";
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

test("parseSheetDate は YYYY/MM/DD をDateに変換する", () => {
  const date = parseSheetDate("2023/11/09");
  expect(date?.getFullYear()).toBe(2023);
  expect(date?.getMonth()).toBe(10);
  expect(date?.getDate()).toBe(9);
});

test("parseSheetDate は空文字/nullでnullを返す", () => {
  expect(parseSheetDate(null)).toBeNull();
  expect(parseSheetDate("")).toBeNull();
});

test("formatSheetDate は YYYY/MM/DD 形式の文字列を返す", () => {
  expect(formatSheetDate(new Date(2026, 6, 12))).toBe("2026/07/12");
});

test("isSkipped は備考にスキップキーワードが含まれていればtrue", () => {
  expect(isSkipped(makeRow({ note: "フォーム無" }))).toBe(true);
  expect(isSkipped(makeRow({ note: "Google Formで不可" }))).toBe(true);
  expect(isSkipped(makeRow({ note: "期間短い" }))).toBe(false);
  expect(isSkipped(makeRow({ note: "" }))).toBe(false);
});

test("isSkipped: 備考にCAPTCHAが含まれていればtrue", () => {
  expect(isSkipped(makeRow({ note: "CAPTCHAあり" }))).toBe(true);
  expect(isSkipped(makeRow({ note: "CAPTCHA" }))).toBe(true);
});

test("getNextAttempt: 1回目が空欄なら1を返す", () => {
  const today = new Date(2026, 6, 12);
  expect(getNextAttempt(makeRow({}), today)).toBe(1);
});

test("getNextAttempt: 商談確定日が入っていれば対象外", () => {
  const today = new Date(2026, 6, 12);
  expect(getNextAttempt(makeRow({ dealStatus: "2026/07/13" }), today)).toBeNull();
});

test("getNextAttempt: 商談確定日が空欄なら対象外にならない", () => {
  const today = new Date(2026, 6, 12);
  expect(getNextAttempt(makeRow({ dealStatus: "" }), today)).toBe(1);
});

test("getNextAttempt: スキップキーワードがあれば対象外", () => {
  const today = new Date(2026, 6, 12);
  expect(getNextAttempt(makeRow({ note: "フォーム無" }), today)).toBeNull();
});

test("getNextAttempt: 3回目済みなら対象外", () => {
  const today = new Date(2026, 6, 12);
  const row = makeRow({
    firstSentAt: "2026/01/01",
    secondSentAt: "2026/02/01",
    thirdSentAt: "2026/03/01",
  });
  expect(getNextAttempt(row, today)).toBeNull();
});

test("getNextAttempt: 1回目から30日未満なら2回目は対象外", () => {
  const row = makeRow({ firstSentAt: "2026/06/20" });
  const today = new Date(2026, 6, 12); // 22日後...ではなく20日後未満のケースを作る
  const notYet = new Date(2026, 6, 15); // 2026/06/20 -> 2026/07/15 は25日後
  expect(getNextAttempt(row, notYet)).toBeNull();
});

test("getNextAttempt: 1回目から30日以上経過していれば2回目が対象", () => {
  const row = makeRow({ firstSentAt: "2026/06/01" });
  const today = new Date(2026, 6, 1); // 2026/07/01、30日後
  expect(getNextAttempt(row, today)).toBe(2);
});

test("getNextAttempt: 2回目から30日以上経過していれば3回目が対象", () => {
  const row = makeRow({
    firstSentAt: "2026/05/01",
    secondSentAt: "2026/06/01",
  });
  const today = new Date(2026, 6, 1); // 2回目から30日後
  expect(getNextAttempt(row, today)).toBe(3);
});

test("selectBatch: 対象行を先頭からbatchSize件だけ返す", () => {
  const rows = [
    makeRow({ rowIndex: 2, companyName: "A" }),
    makeRow({ rowIndex: 3, companyName: "B", note: "フォーム無" }),
    makeRow({ rowIndex: 4, companyName: "C" }),
    makeRow({ rowIndex: 5, companyName: "D" }),
  ];
  const today = new Date(2026, 6, 12);
  const batch = selectBatch(rows, 2, today);
  expect(batch.map((t) => t.row.companyName)).toEqual(["A", "C"]);
  expect(batch.every((t) => t.attemptNumber === 1)).toBe(true);
});

test("dedupeByCompanyName: 企業名が重複していれば送信が最も進んでいる行だけを残す", () => {
  const rows = [
    makeRow({ rowIndex: 2, companyName: "A社" }),
    makeRow({ rowIndex: 3, companyName: "A社", firstSentAt: "2026/06/01" }),
  ];
  const deduped = dedupeByCompanyName(rows);
  expect(deduped.map((r) => r.rowIndex)).toEqual([3]);
});

test("dedupeByCompanyName: 表記ゆれ(前後の空白/大文字小文字)も同一企業として扱う", () => {
  const rows = [
    makeRow({ rowIndex: 2, companyName: " Example Inc " }),
    makeRow({ rowIndex: 3, companyName: "example inc", secondSentAt: "2026/06/01", firstSentAt: "2026/05/01" }),
  ];
  const deduped = dedupeByCompanyName(rows);
  expect(deduped.map((r) => r.rowIndex)).toEqual([3]);
});

test("dedupeByCompanyName: 重複がなければ元の並び順のまま返す", () => {
  const rows = [
    makeRow({ rowIndex: 2, companyName: "A社" }),
    makeRow({ rowIndex: 3, companyName: "B社" }),
  ];
  expect(dedupeByCompanyName(rows)).toEqual(rows);
});

test("dedupeByCompanyName: 企業名が空の行は重複判定せずそのまま残す", () => {
  const rows = [
    makeRow({ rowIndex: 2, companyName: "" }),
    makeRow({ rowIndex: 3, companyName: "" }),
  ];
  expect(dedupeByCompanyName(rows)).toEqual(rows);
});

import { test, expect } from "@playwright/test";
import {
  listedMarker,
  matchListedCompanies,
  selectListedStocks,
  type ListedCompany,
} from "../src/lib/listedScreening.js";
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

const HEADER = ["日付", "コード", "銘柄名", "市場・商品区分"];

function makeCompany(overrides: Partial<ListedCompany>): ListedCompany {
  return { code: "1301", name: "極洋", market: "プライム（内国株式）", ...overrides };
}

test("selectListedStocks: ヘッダー行を除き、株式の銘柄だけを取り出す", () => {
  const rows = [
    HEADER,
    ["20260831", "1301", "極洋", "プライム（内国株式）"],
    ["20260831", "4382", "ＨＥＲＯＺ", "グロース（内国株式）"],
    ["20260831", "7373", "アイドマ・ホールディングス", "スタンダード（内国株式）"],
  ];

  expect(selectListedStocks(rows)).toEqual([
    { code: "1301", name: "極洋", market: "プライム（内国株式）" },
    { code: "4382", name: "ＨＥＲＯＺ", market: "グロース（内国株式）" },
    { code: "7373", name: "アイドマ・ホールディングス", market: "スタンダード（内国株式）" },
  ]);
});

test("selectListedStocks: ETF・REIT・出資証券は企業ではないので除く", () => {
  const rows = [
    HEADER,
    ["20260831", "1305", "ｉＦｒｅｅＥＴＦ　ＴＯＰＩＸ", "ETF・ETN"],
    ["20260831", "8951", "日本ビルファンド投資法人", "REIT・ベンチャーファンド・カントリーファンド・インフラファンド"],
    ["20260831", "8737", "あかつき本社", "出資証券"],
  ];

  expect(selectListedStocks(rows)).toEqual([]);
});

test("selectListedStocks: 外国株式・PRO Marketの銘柄も上場企業として扱う", () => {
  const rows = [
    HEADER,
    ["20260831", "9268", "オプティマスグループ", "スタンダード（外国株式）"],
    ["20260831", "1400", "ルーデン・ホールディングス", "PRO Market"],
  ];

  expect(selectListedStocks(rows).map((company) => company.code)).toEqual(["9268", "1400"]);
});

test("matchListedCompanies: 法人格の表記ゆれを吸収して行を突き合わせる", () => {
  const companies = [makeCompany({ code: "4382", name: "ＨＥＲＯＺ" })];
  const rows = [
    makeRow({ rowIndex: 5, companyName: "HEROZ株式会社" }),
    makeRow({ rowIndex: 6, companyName: "全く別の会社" }),
  ];

  const result = matchListedCompanies(companies, rows);

  expect(result.candidates).toHaveLength(1);
  expect(result.candidates[0].row.rowIndex).toBe(5);
  expect(result.candidates[0].company.code).toBe("4382");
  expect(result.alreadyMarked).toEqual([]);
});

test("matchListedCompanies: すでに「送信NG」が付いている行は書き込み対象から外す", () => {
  const companies = [makeCompany({ code: "4382", name: "ＨＥＲＯＺ" })];
  const rows = [makeRow({ rowIndex: 5, companyName: "HEROZ株式会社", note: "送信NG(スタクラ掲載)" })];

  const result = matchListedCompanies(companies, rows);

  expect(result.candidates).toEqual([]);
  expect(result.alreadyMarked.map((match) => match.row.rowIndex)).toEqual([5]);
});

test("matchListedCompanies: 同じ企業の行が複数あればすべて候補にする", () => {
  const companies = [makeCompany({ code: "4382", name: "ＨＥＲＯＺ" })];
  const rows = [
    makeRow({ rowIndex: 5, companyName: "HEROZ株式会社" }),
    makeRow({ rowIndex: 9, companyName: "株式会社HEROZ" }),
  ];

  const result = matchListedCompanies(companies, rows);

  expect(result.candidates.map((match) => match.row.rowIndex)).toEqual([5, 9]);
});

test("matchListedCompanies: 企業名が空の行は突き合わせに使わない", () => {
  const companies = [makeCompany({ code: "1301", name: "" })];
  const rows = [makeRow({ rowIndex: 5, companyName: "" })];

  expect(matchListedCompanies(companies, rows).candidates).toEqual([]);
});

test("listedMarker: 証券コード付きの「送信NG」を作る", () => {
  expect(listedMarker(makeCompany({ code: "4382" }))).toBe("送信NG(上場 4382)");
});

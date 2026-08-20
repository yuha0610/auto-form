import { test, expect } from "@playwright/test";
import {
  parseJobListingPage,
  parseLastPageNumber,
  aggregateJobCompanies,
  matchStarclaCompanies,
} from "../src/lib/starclaScreening.js";
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

function jobCard(companyId: string, jobId: string, companyName: string): string {
  return `
<article class="cassetteCompany">
  <a href="/online/companies/${companyId}/job_offers/${jobId}/" class="cassetteCompany__inner">
    <h3 class="cassetteCompany__title"><span class="cassetteCompany__titleInner">【CTO候補】バックエンドエンジニア</span></h3>
    <figure class="cassetteCompany__thumb"><img src="https://startupclass.co.jp/rimg/abc" alt="${companyName}" width="369" height="247" loading="lazy"></figure>
  </a>
</article>`;
}

test("parseJobListingPage: 求人カードから企業IDと企業名を取り出す", () => {
  const html = jobCard("1197", "14910", "株式会社Medii") + jobCard("727", "16472", "株式会社バカン");

  expect(parseJobListingPage(html)).toEqual([
    { id: "1197", name: "株式会社Medii" },
    { id: "727", name: "株式会社バカン" },
  ]);
});

test("parseJobListingPage: 求人ページ以外(企業ページ)へのカードは無視する", () => {
  const html = `
<article class="cassetteCompany">
  <a href="/online/companies/2081/" class="cassetteCompany__inner">
    <figure class="cassetteCompany__thumb"><img src="https://startupclass.co.jp/rimg/xyz" alt="株式会社Recho"></figure>
  </a>
</article>`;

  expect(parseJobListingPage(html)).toEqual([]);
});

test("parseJobListingPage: 企業名(alt)が空のカードは無視する", () => {
  expect(parseJobListingPage(jobCard("1197", "14910", ""))).toEqual([]);
});

test("parseLastPageNumber: ページリンクの最大値を返す", () => {
  const html = `<a href="/online/jobs/?page=2">2</a><a href="/online/jobs/?page=90">90</a><a href="/online/jobs/?page=3">3</a>`;
  expect(parseLastPageNumber(html)).toBe(90);
});

test("parseLastPageNumber: ページリンクが無ければ1を返す", () => {
  expect(parseLastPageNumber(`<a href="/online/jobs/">求人</a>`)).toBe(1);
});

test("aggregateJobCompanies: 同じ企業の複数求人を1社にまとめ、求人件数を数える", () => {
  const entries = [
    { id: "1197", name: "株式会社Medii" },
    { id: "727", name: "株式会社バカン" },
    { id: "1197", name: "株式会社Medii" },
  ];

  expect(aggregateJobCompanies(entries)).toEqual([
    { id: "1197", name: "株式会社Medii", jobCount: 2 },
    { id: "727", name: "株式会社バカン", jobCount: 1 },
  ]);
});

test("matchStarclaCompanies: コア名が一致した行を候補として返す", () => {
  const rows = [
    makeRow({ rowIndex: 5, companyName: "株式会社ダイニー" }),
    makeRow({ rowIndex: 6, companyName: "無関係株式会社" }),
  ];
  const companies = [{ id: "10", name: "ダイニー株式会社", jobCount: 3 }];

  const result = matchStarclaCompanies(companies, rows);

  expect(result.candidates).toHaveLength(1);
  expect(result.candidates[0].row.rowIndex).toBe(5);
  expect(result.candidates[0].company.jobCount).toBe(3);
  expect(result.alreadyMarked).toEqual([]);
});

test("matchStarclaCompanies: シートに無い企業は候補に含めない", () => {
  const rows = [makeRow({ rowIndex: 5, companyName: "株式会社ダイニー" })];

  const result = matchStarclaCompanies([{ id: "10", name: "株式会社よそ", jobCount: 1 }], rows);

  expect(result.candidates).toEqual([]);
});

test("matchStarclaCompanies: すでに備考に「送信NG」がある行は候補と分けて返す", () => {
  const rows = [makeRow({ rowIndex: 5, companyName: "株式会社ダイニー", note: "要確認 / 送信NG" })];

  const result = matchStarclaCompanies([{ id: "10", name: "株式会社ダイニー", jobCount: 1 }], rows);

  expect(result.candidates).toEqual([]);
  expect(result.alreadyMarked.map((m) => m.row.rowIndex)).toEqual([5]);
});

test("matchStarclaCompanies: 同じコア名の行が複数あればすべて候補に含める", () => {
  const rows = [
    makeRow({ rowIndex: 5, companyName: "株式会社ダイニー" }),
    makeRow({ rowIndex: 9, companyName: "ダイニー株式会社" }),
  ];

  const result = matchStarclaCompanies([{ id: "10", name: "株式会社ダイニー", jobCount: 1 }], rows);

  expect(result.candidates.map((m) => m.row.rowIndex)).toEqual([5, 9]);
});

test("matchStarclaCompanies: 企業名が空の行は照合対象にしない", () => {
  const rows = [makeRow({ rowIndex: 5, companyName: "" })];

  const result = matchStarclaCompanies([{ id: "10", name: "", jobCount: 1 }], rows);

  expect(result.candidates).toEqual([]);
});

test("matchStarclaCompanies: 社名にキャッチコピーが付いた掲載企業もシートの行に一致させる", () => {
  const rows = [makeRow({ rowIndex: 119, companyName: "エレビスタ株式会社" })];
  const companies = [
    { id: "10", name: "エレビスタ（株）「30人で売上50億突破」少数精鋭ITベンチャー", jobCount: 5 },
  ];

  const result = matchStarclaCompanies(companies, rows);

  expect(result.candidates.map((m) => m.row.rowIndex)).toEqual([119]);
});

test("matchStarclaCompanies: 英語表記と日本語表記が併記された掲載企業も一致させる", () => {
  const rows = [makeRow({ rowIndex: 313, companyName: "ランディット株式会社" })];
  const companies = [{ id: "10", name: "Landit Inc. / ランディット株式会社", jobCount: 16 }];

  const result = matchStarclaCompanies(companies, rows);

  expect(result.candidates.map((m) => m.row.rowIndex)).toEqual([313]);
});

test("matchStarclaCompanies: 旧社名が併記されていれば旧社名の行にも一致させる", () => {
  const rows = [makeRow({ rowIndex: 20, companyName: "株式会社BIDHIT" })];
  const companies = [{ id: "10", name: "OpenProp株式会社（旧社名：BIDHIT）", jobCount: 1 }];

  const result = matchStarclaCompanies(companies, rows);

  expect(result.candidates.map((m) => m.row.rowIndex)).toEqual([20]);
});

test("matchStarclaCompanies: 別名経由で同じ行が二重に候補入りしない", () => {
  const rows = [makeRow({ rowIndex: 313, companyName: "ランディット株式会社" })];
  const companies = [
    { id: "10", name: "ランディット株式会社 / ランディット株式会社（旧社名：ランディット株式会社）", jobCount: 1 },
  ];

  const result = matchStarclaCompanies(companies, rows);

  expect(result.candidates).toHaveLength(1);
});

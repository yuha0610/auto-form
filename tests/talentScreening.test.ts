import { test, expect } from "@playwright/test";
import {
  matchTalentCompanyName,
  matchTalentPageContent,
  selectTalentCandidates,
  talentMarker,
} from "../src/lib/talentScreening.js";
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

test("matchTalentCompanyName: 社名にタレント業のキーワードが含まれていればそのキーワードを返す", () => {
  expect(matchTalentCompanyName("株式会社サンプル芸能")).toBe("芸能");
  expect(matchTalentCompanyName("株式会社サンプルキャスティング")).toBe("キャスティング");
});

test("matchTalentCompanyName: 関係のない社名にはnullを返す", () => {
  expect(matchTalentCompanyName("株式会社サンプル")).toBeNull();
});

test("matchTalentCompanyName: 社名の「タレント」だけでは判断しない(HR系企業を巻き込むため)", () => {
  expect(matchTalentCompanyName("株式会社タレントアンドアセスメント")).toBeNull();
  expect(matchTalentCompanyName("タレントマネジメント株式会社")).toBeNull();
});

test("matchTalentPageContent: 本文にキーワードがあればキーワードと前後の抜粋を返す", () => {
  const result = matchTalentPageContent("当社は芸能プロダクションとして所属タレントを育成しています。");
  expect(result?.keyword).toBe("芸能プロダクション");
  expect(result?.snippet).toContain("芸能プロダクション");
});

test("matchTalentPageContent: モデル事務所も拾う", () => {
  expect(matchTalentPageContent("東京のモデル事務所です")?.keyword).toBe("モデル事務所");
});

test("matchTalentPageContent: 関係のない本文にはnullを返す", () => {
  expect(matchTalentPageContent("弊社はソフトウェア開発を行っています。")).toBeNull();
});

test("matchTalentPageContent: タレントマネジメントシステムのHR SaaSは拾わない", () => {
  expect(matchTalentPageContent("タレントマネジメントシステムを提供しています。")).toBeNull();
  expect(matchTalentPageContent("タレントプールを構築する採用管理ツールです。")).toBeNull();
});

test("matchTalentPageContent: HR用語と本物のキーワードが同居していれば検出する", () => {
  const text = "タレントマネジメントシステムの話題。当社は芸能事務所を運営しています。";
  expect(matchTalentPageContent(text)?.keyword).toBe("芸能事務所");
});

test("talentMarker: 送信NGにタレント業の理由を添えた印を返す", () => {
  expect(talentMarker()).toBe("送信NG(タレント業)");
});

test("selectTalentCandidates: 既に送信NGが付いている行は対象から除く", () => {
  const hit = { keyword: "芸能事務所", snippet: "芸能事務所" };
  const rows = [
    { row: makeRow({ rowIndex: 2 }), match: hit },
    { row: makeRow({ rowIndex: 3, note: "送信NG(上場 1234)" }), match: hit },
  ];
  const result = selectTalentCandidates(rows);
  expect(result.candidates.map((c) => c.row.rowIndex)).toEqual([2]);
  expect(result.alreadyMarked.map((c) => c.row.rowIndex)).toEqual([3]);
});

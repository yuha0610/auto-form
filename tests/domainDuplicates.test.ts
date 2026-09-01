import { test, expect } from "@playwright/test";
import { findDomainDuplicates } from "../src/lib/domainDuplicates.js";
import type { SheetRowData } from "../src/types.js";

function makeRow(overrides: Partial<SheetRowData>): SheetRowData {
  return {
    rowIndex: 2,
    companyName: "サンプル株式会社",
    companyUrl: "",
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

test("findDomainDuplicates: 企業URLのホストが同じ行をグループにする", () => {
  const rows = [
    makeRow({ rowIndex: 3, companyName: "HORIJUKU株式会社", companyUrl: "https://corp.umito.jp/about" }),
    makeRow({ rowIndex: 9, companyName: "株式会社UMITO", companyUrl: "https://corp.umito.jp/" }),
    makeRow({ rowIndex: 12, companyName: "無関係株式会社", companyUrl: "https://example.com/" }),
  ];

  const groups = findDomainDuplicates(rows);

  expect(groups).toHaveLength(1);
  expect(groups[0].key).toBe("corp.umito.jp");
  expect(groups[0].rows.map((r) => r.rowIndex)).toEqual([3, 9]);
});

test("findDomainDuplicates: 社名のコア名が一致するかどうかを示す", () => {
  const sameName = findDomainDuplicates([
    makeRow({ rowIndex: 3, companyName: "株式会社Luup", companyUrl: "https://luup.sc/" }),
    makeRow({ rowIndex: 9, companyName: "Luup", companyUrl: "https://luup.sc/contact" }),
  ]);
  expect(sameName[0].sameCoreName).toBe(true);

  const differentName = findDomainDuplicates([
    makeRow({ rowIndex: 3, companyName: "ストリーツ株式会社", companyUrl: "https://storyhub.jp/" }),
    makeRow({ rowIndex: 9, companyName: "StoryHub株式会社", companyUrl: "https://storyhub.jp/" }),
  ]);
  expect(differentName[0].sameCoreName).toBe(false);
});

test("findDomainDuplicates: www有無の違いを無視する", () => {
  const groups = findDomainDuplicates([
    makeRow({ rowIndex: 3, companyName: "株式会社3DC", companyUrl: "https://www.3dc.co.jp/" }),
    makeRow({ rowIndex: 9, companyName: "株式会社３DC", companyUrl: "https://3dc.co.jp/ja/contact" }),
  ]);

  expect(groups).toHaveLength(1);
  expect(groups[0].key).toBe("3dc.co.jp");
});

test("findDomainDuplicates: フォームURLのホストでも突き合わせる", () => {
  const groups = findDomainDuplicates([
    makeRow({ rowIndex: 3, companyName: "旧社名株式会社", companyUrl: "", formUrl: "https://example.jp/contact" }),
    makeRow({ rowIndex: 9, companyName: "新社名株式会社", companyUrl: "https://example.jp/" }),
  ]);

  expect(groups).toHaveLength(1);
  expect(groups[0].rows.map((r) => r.rowIndex)).toEqual([3, 9]);
});

test("findDomainDuplicates: 単独行はグループにしない", () => {
  const groups = findDomainDuplicates([
    makeRow({ rowIndex: 3, companyUrl: "https://example.com/" }),
    makeRow({ rowIndex: 9, companyUrl: "https://another.com/" }),
  ]);

  expect(groups).toEqual([]);
});

test("findDomainDuplicates: フォームSaaSの共有ホストはホスト一致だけではグループにしない", () => {
  // 別会社がそれぞれ自分のform.runフォームを持っているだけなので重複ではない
  const groups = findDomainDuplicates([
    makeRow({ rowIndex: 3, companyName: "A株式会社", formUrl: "https://form.run/@company-a" }),
    makeRow({ rowIndex: 9, companyName: "B株式会社", formUrl: "https://form.run/@company-b" }),
  ]);

  expect(groups).toEqual([]);
});

test("findDomainDuplicates: 共有ホストでもURLが完全一致すればグループにする", () => {
  // 同じフォームを指している以上、別企業ではありえない(誤登録か重複登録)
  const groups = findDomainDuplicates([
    makeRow({ rowIndex: 3, companyName: "株式会社きゃりこん.com", formUrl: "https://form.run/@caricon-1" }),
    makeRow({ rowIndex: 9, companyName: "株式会社きゃりこん．ｃｏｍ", companyUrl: "https://form.run/@caricon-1" }),
  ]);

  expect(groups).toHaveLength(1);
  expect(groups[0].key).toBe("url:form.run/@caricon-1");
});

test("findDomainDuplicates: 共有ホストでクエリが違うURLは別物として扱う", () => {
  // Google広告のクリックURLはパスが同じでクエリだけが違う。まとめると誤検出になる
  const groups = findDomainDuplicates([
    makeRow({ rowIndex: 3, companyUrl: "https://www.google.com/aclk?ai=AAA&sa=l" }),
    makeRow({ rowIndex: 9, companyUrl: "https://www.google.com/aclk?ai=BBB&sa=l" }),
  ]);

  expect(groups).toEqual([]);
});

test("findDomainDuplicates: 同じ行を二重に数えない", () => {
  // 企業URLとフォームURLが同じホストを指していても、その行は1回だけ数える
  const groups = findDomainDuplicates([
    makeRow({ rowIndex: 3, companyUrl: "https://example.jp/", formUrl: "https://example.jp/contact" }),
  ]);

  expect(groups).toEqual([]);
});

test("findDomainDuplicates: 社名が違うグループを先に返す", () => {
  const groups = findDomainDuplicates([
    makeRow({ rowIndex: 3, companyName: "株式会社Luup", companyUrl: "https://luup.sc/" }),
    makeRow({ rowIndex: 4, companyName: "Luup", companyUrl: "https://luup.sc/contact" }),
    makeRow({ rowIndex: 5, companyName: "ストリーツ株式会社", companyUrl: "https://storyhub.jp/" }),
    makeRow({ rowIndex: 6, companyName: "StoryHub株式会社", companyUrl: "https://storyhub.jp/" }),
  ]);

  expect(groups.map((g) => g.sameCoreName)).toEqual([false, true]);
});

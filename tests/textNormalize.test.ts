import { test, expect } from "@playwright/test";
import { normalizeCellText, extractCompanyCoreName } from "../src/lib/textNormalize.js";

test("normalizeCellText: 前後の全角スペースをトリムする", () => {
  expect(normalizeCellText("　株式会社Example　")).toBe("株式会社Example");
});

test("normalizeCellText: ゼロ幅スペースを除去する", () => {
  expect(normalizeCellText("​株式会社ポリグロッツ")).toBe("株式会社ポリグロッツ");
});

test("normalizeCellText: BOM(U+FEFF)を除去する", () => {
  expect(normalizeCellText("﻿株式会社BOMテスト")).toBe("株式会社BOMテスト");
});

test("normalizeCellText: 半角/全角混在の末尾スペースをトリムする", () => {
  expect(normalizeCellText("エピソテック株式会社 　")).toBe("エピソテック株式会社");
});

test("normalizeCellText: 内部の連続する空白を1つの半角スペースに正規化する", () => {
  expect(normalizeCellText("foo   bar　　baz")).toBe("foo bar baz");
});

test("normalizeCellText: 変更不要な文字列はそのまま返す", () => {
  expect(normalizeCellText("通常のテキスト")).toBe("通常のテキスト");
});

test("normalizeCellText: 空文字列はそのまま返す", () => {
  expect(normalizeCellText("")).toBe("");
});

test("extractCompanyCoreName: 前方の「株式会社」を除去する", () => {
  expect(extractCompanyCoreName("株式会社Luup")).toBe("luup");
});

test("extractCompanyCoreName: 後方の「株式会社」を除去する", () => {
  expect(extractCompanyCoreName("BlueWX株式会社")).toBe("bluewx");
});

test("extractCompanyCoreName: 法人格が付いていない社名はそのまま(小文字化のみ)", () => {
  expect(extractCompanyCoreName("Luup")).toBe("luup");
});

test("extractCompanyCoreName: 英語法人格(Inc./Ltd./Co., Ltd.)を除去する", () => {
  expect(extractCompanyCoreName("Example Inc.")).toBe("example");
  expect(extractCompanyCoreName("Example Ltd.")).toBe("example");
  expect(extractCompanyCoreName("Example Co., Ltd.")).toBe("example");
});

test("extractCompanyCoreName: ㈱を除去する", () => {
  expect(extractCompanyCoreName("㈱テスト")).toBe("テスト");
});

test("extractCompanyCoreName: 記号やスペースを除去する", () => {
  expect(extractCompanyCoreName("株式会社 Do＆Do.")).toBe("do＆do");
});

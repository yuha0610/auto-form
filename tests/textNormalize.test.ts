import { test, expect } from "@playwright/test";
import { normalizeCellText } from "../src/lib/textNormalize.js";

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

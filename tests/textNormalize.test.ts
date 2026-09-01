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
  // アンパサンドはNFKCで半角に寄るため、全角で書かれていても "&" になる
  expect(extractCompanyCoreName("株式会社 Do＆Do.")).toBe("do&do");
});

test("extractCompanyCoreName: 社名の内側にある英字の法人格トークンは除去しない", () => {
  // 「Ginco」の中の Inc を落とすと「Go」になり、GO株式会社と同じコア名になってしまう
  expect(extractCompanyCoreName("株式会社Ginco")).toBe("ginco");
  expect(extractCompanyCoreName("Lincoln株式会社")).toBe("lincoln");
  expect(extractCompanyCoreName("株式会社Corpus")).toBe("corpus");
});

test("extractCompanyCoreName: 独立した法人格トークンは今まで通り除去する", () => {
  expect(extractCompanyCoreName("Sample Inc.")).toBe("sample");
  expect(extractCompanyCoreName("Sample Inc")).toBe("sample");
  expect(extractCompanyCoreName("Sample, Inc.")).toBe("sample");
  expect(extractCompanyCoreName("Sample Co., Ltd.")).toBe("sample");
});

test("extractCompanyCoreName: 全角数字を半角と同じコア名にする", () => {
  // シートに「株式会社12薬局」と「株式会社１２薬局」が別行で並び、重複判定を通り抜けていた
  expect(extractCompanyCoreName("株式会社１２薬局")).toBe("12薬局");
  expect(extractCompanyCoreName("株式会社１２薬局")).toBe(extractCompanyCoreName("株式会社12薬局"));
});

test("extractCompanyCoreName: 全角英字を半角と同じコア名にする", () => {
  expect(extractCompanyCoreName("株式会社３DC")).toBe("3dc");
  expect(extractCompanyCoreName("株式会社きゃりこん．ｃｏｍ")).toBe(
    extractCompanyCoreName("株式会社きゃりこん.com"),
  );
});

test("extractCompanyCoreName: 中黒を区切り記号として除去する", () => {
  expect(extractCompanyCoreName("株式会社サイト・ファクト")).toBe("サイトファクト");
  expect(extractCompanyCoreName("株式会社サイト・ファクト")).toBe(
    extractCompanyCoreName("株式会社サイト-ファクト"),
  );
});

test("extractCompanyCoreName: 半角カタカナを全角と同じコア名にする", () => {
  expect(extractCompanyCoreName("ｼｽﾃﾑ株式会社")).toBe("システム");
});

test("extractCompanyCoreName: 長音符はカタカナの一部として残す", () => {
  // 中黒を落とすついでに長音符まで落とすと「コーヒー」が「コヒ」になり別会社と衝突する
  expect(extractCompanyCoreName("株式会社コーヒー")).toBe("コーヒー");
});

test("extractCompanyCoreName: アンパサンドは幅が違っても同じコア名にする", () => {
  expect(extractCompanyCoreName("株式会社Do＆Do")).toBe(extractCompanyCoreName("株式会社Do&Do"));
});

import { test, expect } from "@playwright/test";
import { matchCompanyName, matchPageContent } from "../src/lib/nonStartupScreening.js";

test("matchCompanyName: 企業名にキーワードが含まれていればそのキーワードを返す", () => {
  expect(matchCompanyName("株式会社ABC学習塾")).toBe("学習塾");
  expect(matchCompanyName("株式会社XYZ予備校")).toBe("予備校");
});

test("matchCompanyName: キーワードが含まれていなければnullを返す", () => {
  expect(matchCompanyName("株式会社サンプル")).toBeNull();
});

test("matchPageContent: 本文にキーワードが含まれていればキーワードと前後の抜粋を返す", () => {
  const text = "EdTechを活用した個別指導塾『アジスタ』を運営しています。";
  const result = matchPageContent(text);
  expect(result?.keyword).toBe("個別指導塾");
  expect(result?.snippet).toContain("個別指導塾");
});

test("matchPageContent: キーワードが含まれていなければnullを返す", () => {
  expect(matchPageContent("弊社はソフトウェア開発を行っています。")).toBeNull();
});

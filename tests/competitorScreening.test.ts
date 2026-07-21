import { test, expect } from "@playwright/test";
import {
  matchCompanyName,
  matchPageContent,
  resolveOverviewUrl,
} from "../src/lib/competitorScreening.js";

test("matchCompanyName: 企業名にキーワードが含まれていればそのキーワードを返す", () => {
  expect(matchCompanyName("株式会社ABC人材紹介")).toBe("人材紹介");
  expect(matchCompanyName("株式会社XYZ RPOサービス")).toBe("RPO");
});

test("matchCompanyName: キーワードが含まれていなければnullを返す", () => {
  expect(matchCompanyName("株式会社サンプル")).toBeNull();
});

test("matchPageContent: 本文にキーワードが含まれていればキーワードと前後の抜粋を返す", () => {
  const text = "弊社は企業の採用活動を支援するRPOサービスを提供しています。";
  const result = matchPageContent(text);
  expect(result?.keyword).toBe("RPO");
  expect(result?.snippet).toContain("RPO");
});

test("matchPageContent: キーワードが含まれていなければnullを返す", () => {
  expect(matchPageContent("弊社はソフトウェア開発を行っています。")).toBeNull();
});

test("resolveOverviewUrl: 会社概要等のリンクがあれば絶対URLを返す", () => {
  const html = `<a href="/about">会社概要</a>`;
  expect(resolveOverviewUrl("https://example.com/", html)).toBe("https://example.com/about");
});

test("resolveOverviewUrl: 該当リンクがなければnullを返す", () => {
  const html = `<a href="/blog">ブログ</a>`;
  expect(resolveOverviewUrl("https://example.com/", html)).toBeNull();
});

test("resolveOverviewUrl: フラグメントのみのリンク(同一ページ内アンカー)は無視する", () => {
  const html = `<a href="#company">会社概要</a>`;
  expect(resolveOverviewUrl("https://example.com/", html)).toBeNull();
});

test("resolveOverviewUrl: 事業内容ページへのリンクも検出する", () => {
  const html = `<a href="/business">事業内容</a>`;
  expect(resolveOverviewUrl("https://example.com/", html)).toBe("https://example.com/business");
});

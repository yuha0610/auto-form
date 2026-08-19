import { test, expect } from "@playwright/test";
import { buildBodyExcerpt, formatUncertainLogLine } from "../src/lib/uncertainLog.js";

test("buildBodyExcerpt: 改行や連続する空白を1つのスペースにまとめる", () => {
  expect(buildBodyExcerpt("お問い合わせ\n\nありがとう　 ございます")).toBe(
    "お問い合わせ ありがとう ございます",
  );
});

test("buildBodyExcerpt: 前後の空白を落とす", () => {
  expect(buildBodyExcerpt("  完了しました  ")).toBe("完了しました");
});

test("buildBodyExcerpt: 上限を超える分は切り捨てる", () => {
  const excerpt = buildBodyExcerpt("あ".repeat(50), 10);
  expect(excerpt).toBe("あ".repeat(10));
});

test("buildBodyExcerpt: 上限以内の文字列はそのまま返す", () => {
  expect(buildBodyExcerpt("短い本文", 10)).toBe("短い本文");
});

test("formatUncertainLogLine: JSON Lines形式の1行(末尾に改行)を返す", () => {
  const line = formatUncertainLogLine({
    timestamp: "2026-08-19T10:00:00.000Z",
    companyName: "サンプル株式会社",
    url: "https://example.com/contact",
    bodyExcerpt: "お問い合わせを承りました",
  });
  expect(line.endsWith("\n")).toBe(true);
  expect(JSON.parse(line)).toEqual({
    timestamp: "2026-08-19T10:00:00.000Z",
    companyName: "サンプル株式会社",
    url: "https://example.com/contact",
    bodyExcerpt: "お問い合わせを承りました",
  });
});

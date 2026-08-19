import { test, expect } from "@playwright/test";
import { isAffirmative } from "../src/lib/answers.js";

test("isAffirmative: 半角のyを肯定として扱う", () => {
  expect(isAffirmative("y")).toBe(true);
  expect(isAffirmative("Y")).toBe(true);
});

test("isAffirmative: 全角のｙも肯定として扱う(日本語IMEが有効なまま入力された場合)", () => {
  // 実際にこれで入力が無視され、送信済みの3社が記録されなかった
  expect(isAffirmative("ｙ")).toBe(true);
  expect(isAffirmative("Ｙ")).toBe(true);
});

test("isAffirmative: yes / はい も肯定として扱う", () => {
  expect(isAffirmative("yes")).toBe(true);
  expect(isAffirmative("YES")).toBe(true);
  expect(isAffirmative("ｙｅｓ")).toBe(true);
  expect(isAffirmative("はい")).toBe(true);
});

test("isAffirmative: 前後の空白(全角スペース含む)を無視する", () => {
  expect(isAffirmative(" y ")).toBe(true);
  expect(isAffirmative("　y　")).toBe(true);
});

test("isAffirmative: 空入力は否定として扱う", () => {
  expect(isAffirmative("")).toBe(false);
  expect(isAffirmative("   ")).toBe(false);
  expect(isAffirmative("　")).toBe(false);
});

test("isAffirmative: n やその他の入力は否定として扱う", () => {
  expect(isAffirmative("n")).toBe(false);
  expect(isAffirmative("no")).toBe(false);
  expect(isAffirmative("いいえ")).toBe(false);
  expect(isAffirmative("あとで")).toBe(false);
});

test("isAffirmative: yを含むだけの文字列は肯定にしない(誤爆防止)", () => {
  expect(isAffirmative("yay")).toBe(false);
  expect(isAffirmative("y no")).toBe(false);
});

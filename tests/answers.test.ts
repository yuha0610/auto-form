import { test, expect } from "@playwright/test";
import { parseAnswerNumber } from "../src/lib/answers.js";

test("parseAnswerNumber: 半角数字を数値として読む", () => {
  expect(parseAnswerNumber("3")).toBe(3);
  expect(parseAnswerNumber("12")).toBe(12);
});

test("parseAnswerNumber: 全角数字も読む(日本語IMEが有効なまま入力された場合)", () => {
  // 全角の「ｙ」が弾かれて送信済み3社の記録が消えたのと同じ種類の失敗を防ぐ
  expect(parseAnswerNumber("３")).toBe(3);
  expect(parseAnswerNumber("１２")).toBe(12);
});

test("parseAnswerNumber: 前後の空白(全角スペース含む)を無視する", () => {
  expect(parseAnswerNumber(" 3 ")).toBe(3);
  expect(parseAnswerNumber("　3　")).toBe(3);
});

test("parseAnswerNumber: 空入力にはnullを返す", () => {
  expect(parseAnswerNumber("")).toBeNull();
  expect(parseAnswerNumber("   ")).toBeNull();
  expect(parseAnswerNumber("　")).toBeNull();
});

test("parseAnswerNumber: 数値として読めない入力にはnullを返す", () => {
  expect(parseAnswerNumber("abc")).toBeNull();
  expect(parseAnswerNumber("3社")).toBeNull();
  expect(parseAnswerNumber("いいえ")).toBeNull();
});

test("parseAnswerNumber: 整数でない入力にはnullを返す", () => {
  expect(parseAnswerNumber("3.5")).toBeNull();
  expect(parseAnswerNumber("-2")).toBeNull();
});

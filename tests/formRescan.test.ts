import { test, expect } from "@playwright/test";
import { planRescanWrites, removeNoteMarker } from "../src/lib/formRescan.js";
import type { SheetRowData } from "../src/types.js";

function makeRow(overrides: Partial<SheetRowData>): SheetRowData {
  return {
    rowIndex: 2,
    companyName: "サンプル株式会社",
    companyUrl: "https://example.com/",
    formUrl: "",
    note: "フォーム無(要確認)",
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

test("removeNoteMarker: 印を含む区切りだけを取り除く", () => {
  expect(removeNoteMarker("要確認 / フォーム無(要確認) / 要確認", "フォーム無")).toBe("要確認 / 要確認");
});

test("removeNoteMarker: 印だけの備考は空になる", () => {
  expect(removeNoteMarker("フォーム無(要確認)", "フォーム無")).toBe("");
});

test("removeNoteMarker: 印が無ければそのまま返す", () => {
  expect(removeNoteMarker("要確認 / CAPTCHA", "フォーム無")).toBe("要確認 / CAPTCHA");
});

test("removeNoteMarker: 同じ印が複数あればすべて取り除く", () => {
  expect(removeNoteMarker("フォーム無 / 要確認 / フォーム無(要確認)", "フォーム無")).toBe("要確認");
});

test("removeNoteMarker: 他の印の一部に含まれる文字は誤って消さない", () => {
  // 「送信NG」を消すつもりで「送信失敗」まで消さないことを確かめる
  expect(removeNoteMarker("送信失敗 / 送信NG", "送信NG")).toBe("送信失敗");
});

test("planRescanWrites: 別ページのフォームが見つかればURLを保存し「フォーム無」を外す", () => {
  const row = makeRow({ note: "要確認 / フォーム無(要確認)" });
  expect(planRescanWrites(row, { kind: "form", url: "https://example.com/contact" }, "フォーム無")).toEqual({
    kind: "form",
    formUrl: "https://example.com/contact",
    note: "要確認",
  });
});

test("planRescanWrites: 同じページにフォームがある場合はそのページのURLを保存する", () => {
  const row = makeRow({ companyUrl: "https://example.com/lp" });
  expect(planRescanWrites(row, { kind: "same-page", url: "https://example.com/lp" }, "フォーム無")).toEqual({
    kind: "same-page",
    formUrl: "https://example.com/lp",
    note: "",
  });
});

test("planRescanWrites: メールアドレスだった場合はメール列に保存する", () => {
  expect(planRescanWrites(makeRow({}), { kind: "email", address: "info@example.com" }, "フォーム無")).toEqual({
    kind: "email",
    email: "info@example.com",
    note: "メール",
  });
});

test("planRescanWrites: Google Formだった場合は印を差し替える", () => {
  const row = makeRow({ note: "要確認 / フォーム無(要確認)" });
  expect(planRescanWrites(row, { kind: "google-form", url: "https://forms.gle/x" }, "フォーム無")).toEqual({
    kind: "google-form",
    note: "要確認 / Google Formで不可",
  });
});

test("planRescanWrites: 見つからなければ何も書き込まない(「フォーム無」を残す)", () => {
  expect(planRescanWrites(makeRow({}), null, "フォーム無")).toBeNull();
});

test("planRescanWrites: すでにフォームURLが入っている行は上書きしない", () => {
  // 人が手で貼ったURLを、再スキャンの結果で潰さないため
  const row = makeRow({ formUrl: "https://example.com/manual-form" });
  expect(planRescanWrites(row, { kind: "form", url: "https://example.com/contact" }, "フォーム無")).toEqual({
    kind: "form",
    note: "",
  });
});

test("planRescanWrites: すでにメールアドレスが入っている行は上書きしない", () => {
  const row = makeRow({ email: "sales@example.com" });
  expect(planRescanWrites(row, { kind: "email", address: "info@example.com" }, "フォーム無")).toEqual({
    kind: "email",
    note: "メール",
  });
});

test("planRescanWrites: 渡した印を外す(「読み込み失敗(要確認)」でも使える)", () => {
  const row = makeRow({ note: "要確認 / 読み込み失敗(要確認)" });
  expect(
    planRescanWrites(row, { kind: "form", url: "https://example.com/contact" }, "読み込み失敗(要確認)"),
  ).toEqual({
    kind: "form",
    formUrl: "https://example.com/contact",
    note: "要確認",
  });
});

test("planRescanWrites: 渡した印以外は残す", () => {
  // 「読み込み失敗」を外すつもりで「フォーム無」まで消さないことを確かめる
  const row = makeRow({ note: "フォーム無 / 読み込み失敗(要確認)" });
  expect(
    planRescanWrites(row, { kind: "form", url: "https://example.com/contact" }, "読み込み失敗(要確認)"),
  ).toEqual({
    kind: "form",
    formUrl: "https://example.com/contact",
    note: "フォーム無",
  });
});

test("planRescanWrites: 既存のフォームURLがURLの形をしていなければ上書きする", () => {
  // 実際に「y」だけが入っている行があり、守るとフォームを開けない行が送信対象に戻ってしまう
  const row = makeRow({ formUrl: "y" });
  expect(planRescanWrites(row, { kind: "form", url: "https://example.com/contact" }, "フォーム無")).toEqual({
    kind: "form",
    formUrl: "https://example.com/contact",
    note: "",
  });
});

test("planRescanWrites: 既存のメールアドレスがアドレスの形をしていなければ上書きする", () => {
  const row = makeRow({ email: "なし" });
  expect(planRescanWrites(row, { kind: "email", address: "info@example.com" }, "フォーム無")).toEqual({
    kind: "email",
    email: "info@example.com",
    note: "メール",
  });
});

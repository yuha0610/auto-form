import { test, expect } from "@playwright/test";
import {
  parseSheetDate,
  formatSheetDate,
  isSkipped,
  getNextAttempt,
  hasRecentSignal,
  selectBatch,
  dedupeByCompanyName,
  summarizeSkipped,
  selectFormMissingRetryTargets,
} from "../src/lib/targetSelection.js";
import type { SheetRowData } from "../src/types.js";

function makeRow(overrides: Partial<SheetRowData>): SheetRowData {
  return {
    rowIndex: 2,
    companyName: "サンプル株式会社",
    companyUrl: "https://example.com/",
    formUrl: "",
    note: "",
    dealStatus: "",
    firstSentAt: null,
    secondSentAt: null,
    thirdSentAt: null,
    email: "",
    signalType: "",
    signalDate: null,
    signalSourceUrl: "",
    ...overrides,
  };
}

test("parseSheetDate は YYYY/MM/DD をDateに変換する", () => {
  const date = parseSheetDate("2023/11/09");
  expect(date?.getFullYear()).toBe(2023);
  expect(date?.getMonth()).toBe(10);
  expect(date?.getDate()).toBe(9);
});

test("parseSheetDate は空文字/nullでnullを返す", () => {
  expect(parseSheetDate(null)).toBeNull();
  expect(parseSheetDate("")).toBeNull();
});

test("formatSheetDate は YYYY/MM/DD 形式の文字列を返す", () => {
  expect(formatSheetDate(new Date(2026, 6, 12))).toBe("2026/07/12");
});

test("isSkipped は備考にスキップキーワードが含まれていればtrue", () => {
  expect(isSkipped(makeRow({ note: "フォーム無" }))).toBe(true);
  expect(isSkipped(makeRow({ note: "Google Formで不可" }))).toBe(true);
  expect(isSkipped(makeRow({ note: "期間短い" }))).toBe(false);
  expect(isSkipped(makeRow({ note: "" }))).toBe(false);
});

test("isSkipped: 備考にCAPTCHAが含まれていればtrue", () => {
  expect(isSkipped(makeRow({ note: "CAPTCHAあり" }))).toBe(true);
  expect(isSkipped(makeRow({ note: "CAPTCHA" }))).toBe(true);
});

test("isSkipped: 備考に「営業・セールスお断り」が含まれていればtrue", () => {
  expect(isSkipped(makeRow({ note: "営業・セールスお断り" }))).toBe(true);
});

test("isSkipped: 備考に「送信NG」が含まれていればtrue", () => {
  expect(isSkipped(makeRow({ note: "送信NG" }))).toBe(true);
  expect(isSkipped(makeRow({ note: "要確認 / 送信NG" }))).toBe(true);
});

test("isSkipped: メールアドレス列に値があればtrue", () => {
  expect(isSkipped(makeRow({ email: "info@example.com" }))).toBe(true);
});

test("isSkipped: メールアドレス列が空ならnoteの内容のみで判定する", () => {
  expect(isSkipped(makeRow({ email: "" }))).toBe(false);
});

test("getNextAttempt: 1回目が空欄なら1を返す", () => {
  const today = new Date(2026, 6, 12);
  expect(getNextAttempt(makeRow({}), today)).toBe(1);
});

test("getNextAttempt: 商談確定日が入っていれば対象外", () => {
  const today = new Date(2026, 6, 12);
  expect(getNextAttempt(makeRow({ dealStatus: "2026/07/13" }), today)).toBeNull();
});

test("getNextAttempt: 商談確定日が空欄なら対象外にならない", () => {
  const today = new Date(2026, 6, 12);
  expect(getNextAttempt(makeRow({ dealStatus: "" }), today)).toBe(1);
});

test("getNextAttempt: スキップキーワードがあれば対象外", () => {
  const today = new Date(2026, 6, 12);
  expect(getNextAttempt(makeRow({ note: "フォーム無" }), today)).toBeNull();
});

test("getNextAttempt: メールアドレス列に値があれば対象外", () => {
  const today = new Date(2026, 6, 12);
  expect(getNextAttempt(makeRow({ email: "info@example.com" }), today)).toBeNull();
});

test("getNextAttempt: 3回目済みなら対象外", () => {
  const today = new Date(2026, 6, 12);
  const row = makeRow({
    firstSentAt: "2026/01/01",
    secondSentAt: "2026/02/01",
    thirdSentAt: "2026/03/01",
  });
  expect(getNextAttempt(row, today)).toBeNull();
});

test("getNextAttempt: 1回目から14日未満なら2回目は対象外", () => {
  const row = makeRow({ firstSentAt: "2026/07/01" });
  const notYet = new Date(2026, 6, 10); // 9日後
  expect(getNextAttempt(row, notYet)).toBeNull();
});

test("getNextAttempt: 1回目から14日以上経過していれば2回目が対象", () => {
  const row = makeRow({ firstSentAt: "2026/07/01" });
  const today = new Date(2026, 6, 15); // 14日後
  expect(getNextAttempt(row, today)).toBe(2);
});

test("getNextAttempt: 2回目から14日以上経過していれば3回目が対象", () => {
  const row = makeRow({
    firstSentAt: "2026/05/01",
    secondSentAt: "2026/07/01",
  });
  const today = new Date(2026, 6, 15); // 2回目から14日後
  expect(getNextAttempt(row, today)).toBe(3);
});

test("selectBatch: 対象行を先頭からbatchSize件だけ返す", () => {
  const rows = [
    makeRow({ rowIndex: 2, companyName: "A" }),
    makeRow({ rowIndex: 3, companyName: "B", note: "フォーム無" }),
    makeRow({ rowIndex: 4, companyName: "C" }),
    makeRow({ rowIndex: 5, companyName: "D" }),
  ];
  const today = new Date(2026, 6, 12);
  const batch = selectBatch(rows, 2, today);
  expect(batch.map((t) => t.row.companyName)).toEqual(["A", "C"]);
  expect(batch.every((t) => t.attemptNumber === 1)).toBe(true);
});

test("dedupeByCompanyName: 企業名が重複していれば送信が最も進んでいる行だけを残す", () => {
  const rows = [
    makeRow({ rowIndex: 2, companyName: "A社" }),
    makeRow({ rowIndex: 3, companyName: "A社", firstSentAt: "2026/06/01" }),
  ];
  const deduped = dedupeByCompanyName(rows);
  expect(deduped.map((r) => r.rowIndex)).toEqual([3]);
});

test("dedupeByCompanyName: 表記ゆれ(前後の空白/大文字小文字)も同一企業として扱う", () => {
  const rows = [
    makeRow({ rowIndex: 2, companyName: " Example Inc " }),
    makeRow({ rowIndex: 3, companyName: "example inc", secondSentAt: "2026/06/01", firstSentAt: "2026/05/01" }),
  ];
  const deduped = dedupeByCompanyName(rows);
  expect(deduped.map((r) => r.rowIndex)).toEqual([3]);
});

test("dedupeByCompanyName: 重複がなければ元の並び順のまま返す", () => {
  const rows = [
    makeRow({ rowIndex: 2, companyName: "A社" }),
    makeRow({ rowIndex: 3, companyName: "B社" }),
  ];
  expect(dedupeByCompanyName(rows)).toEqual(rows);
});

test("dedupeByCompanyName: 企業名が空の行は重複判定せずそのまま残す", () => {
  const rows = [
    makeRow({ rowIndex: 2, companyName: "" }),
    makeRow({ rowIndex: 3, companyName: "" }),
  ];
  expect(dedupeByCompanyName(rows)).toEqual(rows);
});

test("summarizeSkipped: スキップ理由ごとに企業名をグルーピングする", () => {
  const rows = [
    makeRow({ companyName: "A社", note: "フォーム無" }),
    makeRow({ companyName: "B社", note: "CAPTCHAあり" }),
    makeRow({ companyName: "C社", note: "フォーム無" }),
    makeRow({ companyName: "D社", note: "" }),
  ];
  expect(summarizeSkipped(rows)).toEqual([
    { reason: "フォーム無", companies: ["A社", "C社"] },
    { reason: "CAPTCHA", companies: ["B社"] },
  ]);
});

test("summarizeSkipped: スキップされた行が無ければ空配列を返す", () => {
  const rows = [makeRow({ companyName: "A社", note: "" })];
  expect(summarizeSkipped(rows)).toEqual([]);
});

test("summarizeSkipped: メールアドレス登録済みの行も区分として集計する", () => {
  const rows = [
    makeRow({ companyName: "A社", note: "フォーム無" }),
    makeRow({ companyName: "B社", email: "info@example.com" }),
    makeRow({ companyName: "C社", note: "" }),
  ];
  expect(summarizeSkipped(rows)).toEqual([
    { reason: "フォーム無", companies: ["A社"] },
    { reason: "メールアドレス登録済み", companies: ["B社"] },
  ]);
});

test("hasRecentSignal: 検知日が14日以内ならtrue", () => {
  const row = makeRow({ signalDate: "2026/07/01" });
  const today = new Date(2026, 6, 15); // 14日後
  expect(hasRecentSignal(row, today)).toBe(true);
});

test("hasRecentSignal: 検知日が30日ちょうどならtrue(境界を含む)", () => {
  const row = makeRow({ signalDate: "2026/07/01" });
  const today = new Date(2026, 6, 31); // 30日後
  expect(hasRecentSignal(row, today)).toBe(true);
});

test("hasRecentSignal: 検知日が30日を超えていればfalse", () => {
  const row = makeRow({ signalDate: "2026/07/01" });
  const today = new Date(2026, 7, 1); // 31日後
  expect(hasRecentSignal(row, today)).toBe(false);
});

test("hasRecentSignal: 検知日が無ければfalse", () => {
  const row = makeRow({ signalDate: null });
  expect(hasRecentSignal(row, new Date(2026, 6, 15))).toBe(false);
});

test("シグナルの有効期間を延ばしてもフォローアップ間隔は14日のまま", () => {
  // 同じ定数を使い回すと、シグナルの窓を広げた途端に2回目送信が30日後になってしまう
  const row = makeRow({ firstSentAt: "2026/07/01" });
  expect(getNextAttempt(row, new Date(2026, 6, 14))).toBeNull(); // 13日後は早すぎる
  expect(getNextAttempt(row, new Date(2026, 6, 15))).toBe(2); // 14日後で2回目が対象
});

test("selectBatch: 検知シグナルがある対象を先頭に並べ替える", () => {
  const rows = [
    makeRow({ rowIndex: 2, companyName: "A" }),
    makeRow({ rowIndex: 3, companyName: "B", signalDate: "2026/07/10" }),
    makeRow({ rowIndex: 4, companyName: "C" }),
  ];
  const today = new Date(2026, 6, 15); // Bの検知日から5日後
  const batch = selectBatch(rows, 3, today);
  expect(batch.map((t) => t.row.companyName)).toEqual(["B", "A", "C"]);
});

test("selectBatch: シグナルがある対象同士は検知日が新しい順に並ぶ", () => {
  // シート順と検知日の新しい順がちょうど逆になるように並べる。
  // (シート順のままでも偶然一致してしまう並びだと、並び替えを検証できない)
  const rows = [
    makeRow({ rowIndex: 2, companyName: "古い", signalDate: "2026/07/01" }),
    makeRow({ rowIndex: 3, companyName: "中間", signalDate: "2026/07/10" }),
    makeRow({ rowIndex: 4, companyName: "新しい", signalDate: "2026/07/20" }),
  ];
  const today = new Date(2026, 6, 21); // 3件とも30日以内に収まる
  const batch = selectBatch(rows, 3, today);
  expect(batch.map((t) => t.row.companyName)).toEqual(["新しい", "中間", "古い"]);
});

test("selectBatch: シグナルなしの対象同士はシートの並び順を保つ", () => {
  const rows = [
    makeRow({ rowIndex: 2, companyName: "A" }),
    makeRow({ rowIndex: 3, companyName: "B" }),
    makeRow({ rowIndex: 4, companyName: "C" }),
  ];
  const batch = selectBatch(rows, 3, new Date(2026, 6, 21));
  expect(batch.map((t) => t.row.companyName)).toEqual(["A", "B", "C"]);
});

test("selectBatch: 検知日が同じシグナル同士はシートの並び順を保つ", () => {
  const rows = [
    makeRow({ rowIndex: 2, companyName: "先", signalDate: "2026/07/10" }),
    makeRow({ rowIndex: 3, companyName: "後", signalDate: "2026/07/10" }),
  ];
  const batch = selectBatch(rows, 2, new Date(2026, 6, 15));
  expect(batch.map((t) => t.row.companyName)).toEqual(["先", "後"]);
});

test("selectBatch: 30日以内のシグナルは優先されるが、超えたものは通常扱いになる", () => {
  const rows = [
    makeRow({ rowIndex: 2, companyName: "シグナルなし" }),
    makeRow({ rowIndex: 3, companyName: "期限切れ", signalDate: "2026/06/01" }),
    makeRow({ rowIndex: 4, companyName: "25日前", signalDate: "2026/06/26" }),
  ];
  const today = new Date(2026, 6, 21); // 6/26から25日後 / 6/1から50日後
  const batch = selectBatch(rows, 3, today);
  expect(batch.map((t) => t.row.companyName)).toEqual(["25日前", "シグナルなし", "期限切れ"]);
});

test("selectFormMissingRetryTargets: 備考に「フォーム無」を含む行だけを対象にする", () => {
  const rows = [
    makeRow({ rowIndex: 2, companyName: "A社", note: "フォーム無(要確認)" }),
    makeRow({ rowIndex: 3, companyName: "B社", note: "URL不正(名前解決失敗)" }),
    makeRow({ rowIndex: 4, companyName: "C社", note: "" }),
  ];
  const today = new Date(2026, 6, 12);
  const targets = selectFormMissingRetryTargets(rows, today);
  expect(targets.map((t) => t.row.companyName)).toEqual(["A社"]);
});

test("selectFormMissingRetryTargets: 商談確定日が入っていれば対象外", () => {
  const rows = [makeRow({ note: "フォーム無", dealStatus: "2026/07/01" })];
  expect(selectFormMissingRetryTargets(rows, new Date(2026, 6, 12))).toEqual([]);
});

test("selectFormMissingRetryTargets: 備考に「送信NG」がある行は対象から外す", () => {
  const rows = [
    makeRow({ rowIndex: 2, companyName: "A", note: "フォーム無" }),
    makeRow({ rowIndex: 3, companyName: "B", note: "フォーム無(要確認) / 送信NG" }),
  ];
  const targets = selectFormMissingRetryTargets(rows, new Date(2026, 0, 1));
  expect(targets.map((t) => t.row.companyName)).toEqual(["A"]);
});

test("selectFormMissingRetryTargets: シグナルがある企業を先頭に、検知日の新しい順に並べる", () => {
  // 大型調達直後の企業が「フォーム無」バケツに埋もれると、328社を上から開く間に
  // 見逃してしまうため、通常バッチと同じ優先順位を効かせる。
  // シート順と新しい順がちょうど逆になるように並べて、並び替えを検証する。
  const rows = [
    makeRow({ rowIndex: 2, companyName: "シグナルなし", note: "フォーム無" }),
    makeRow({ rowIndex: 3, companyName: "古い", note: "フォーム無", signalDate: "2026/07/01" }),
    makeRow({ rowIndex: 4, companyName: "新しい", note: "フォーム無", signalDate: "2026/07/20" }),
  ];
  const today = new Date(2026, 6, 21);
  const targets = selectFormMissingRetryTargets(rows, today);
  expect(targets.map((t) => t.row.companyName)).toEqual(["新しい", "古い", "シグナルなし"]);
});

test("selectFormMissingRetryTargets: シグナルがない企業同士はシートの並び順を保つ", () => {
  const rows = [
    makeRow({ rowIndex: 2, companyName: "A", note: "フォーム無" }),
    makeRow({ rowIndex: 3, companyName: "B", note: "フォーム無" }),
    makeRow({ rowIndex: 4, companyName: "C", note: "フォーム無" }),
  ];
  const targets = selectFormMissingRetryTargets(rows, new Date(2026, 6, 21));
  expect(targets.map((t) => t.row.companyName)).toEqual(["A", "B", "C"]);
});

test("selectFormMissingRetryTargets: 通常はisSkippedで除外される行でもattemptNumberを計算して対象に含む", () => {
  const row = makeRow({ note: "フォーム無", firstSentAt: "2026/07/01" });
  const today = new Date(2026, 6, 15); // 1回目から14日後 → 2回目が対象
  const targets = selectFormMissingRetryTargets([row], today);
  expect(targets).toHaveLength(1);
  expect(targets[0].attemptNumber).toBe(2);
});

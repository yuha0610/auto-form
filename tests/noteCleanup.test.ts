import { test, expect } from "@playwright/test";
import { planNoteCleanup } from "../src/lib/noteCleanup.js";
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

test("積み上がった同じ印を1つにまとめる", () => {
  const row = makeRow({ note: "URL不正(名前解決失敗) / URL不正(名前解決失敗) / URL不正(名前解決失敗)" });
  const [target] = planNoteCleanup([row]);
  expect(target.newNote).toBe("URL不正(名前解決失敗)");
});

test("違う印が並んでいる場合は順番を保って両方残す", () => {
  const row = makeRow({ note: "要確認 / タイムアウト(再試行済・要確認) / 要確認" });
  const [target] = planNoteCleanup([row]);
  expect(target.newNote).toBe("要確認 / タイムアウト(再試行済・要確認)");
});

test("一時的な失敗を2回以上繰り返した行には「接続不可」を付けて打ち切る", () => {
  const row = makeRow({ note: "接続エラー(再試行済・要確認) / 接続エラー(再試行済・要確認)" });
  const [target] = planNoteCleanup([row]);
  expect(target.newNote).toBe("接続エラー(再試行済・要確認) / 接続不可");
});

test("一時的な失敗が1回だけの行は再挑戦の余地を残して触らない", () => {
  const row = makeRow({ note: "タイムアウト(再試行済・要確認)" });
  expect(planNoteCleanup([row])).toEqual([]);
});

test("きれいな備考の行は書き換え対象にしない", () => {
  const row = makeRow({ note: "メール / 要確認" });
  expect(planNoteCleanup([row])).toEqual([]);
});

test("すでに「接続不可」が付いている行に二重で付けない", () => {
  const row = makeRow({ note: "タイムアウト(再試行済・要確認) / タイムアウト(再試行済・要確認) / 接続不可" });
  const [target] = planNoteCleanup([row]);
  expect(target.newNote).toBe("タイムアウト(再試行済・要確認) / 接続不可");
});

test("手で書いた備考の中の日付を区切りと誤認して壊さない", () => {
  const row = makeRow({ note: "送信NG / フォーム営業外で商談獲得(2026/08/27時点)" });
  expect(planNoteCleanup([row])).toEqual([]);
});

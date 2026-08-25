import { test, expect } from "@playwright/test";
import { parseSkipMarkArgs, planSkipMarks, resolveSkipReason } from "../src/lib/skipMarking.js";
import { NEVER_SEND_MARKER } from "../src/lib/targetSelection.js";
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

const rows = [
  makeRow({ rowIndex: 2, companyName: "アルファ株式会社", companyUrl: "https://alpha.example.com/" }),
  makeRow({
    rowIndex: 3,
    companyName: "ベータ株式会社",
    companyUrl: "https://beta.example.jp/company/",
    formUrl: "https://beta.example.jp/inquiry/",
  }),
];

test("planSkipMarks: 会社URL・フォームURLのどちらで貼っても対象になる", () => {
  const plan = planSkipMarks("https://alpha.example.com/ https://beta.example.jp/inquiry/", rows, NEVER_SEND_MARKER);
  expect(plan.targets.map((t) => t.row.rowIndex)).toEqual([2, 3]);
  expect(plan.unmatched).toEqual([]);
  expect(plan.ambiguous).toEqual([]);
});

test("planSkipMarks: ホストが同じならパスが違っても拾う", () => {
  const plan = planSkipMarks("https://beta.example.jp/contact/thanks?id=1", rows, NEVER_SEND_MARKER);
  expect(plan.targets.map((t) => t.row.rowIndex)).toEqual([3]);
});

test("planSkipMarks: 追記後の備考は既存の内容を残す", () => {
  const withNote = [makeRow({ rowIndex: 5, companyUrl: "https://alpha.example.com/", note: "要確認" })];
  const plan = planSkipMarks("https://alpha.example.com/", withNote, NEVER_SEND_MARKER);
  expect(plan.targets[0].newNote).toBe(`要確認 / ${NEVER_SEND_MARKER}`);
});

test("planSkipMarks: 備考が空なら印だけを書く", () => {
  const plan = planSkipMarks("https://alpha.example.com/", rows, NEVER_SEND_MARKER);
  expect(plan.targets[0].newNote).toBe(NEVER_SEND_MARKER);
});

test("planSkipMarks: すでに同じ印がある行は書き込み対象にしない", () => {
  const marked = [makeRow({ rowIndex: 7, companyUrl: "https://alpha.example.com/", note: `要確認 / ${NEVER_SEND_MARKER}` })];
  const plan = planSkipMarks("https://alpha.example.com/", marked, NEVER_SEND_MARKER);
  expect(plan.targets).toEqual([]);
  expect(plan.alreadyMarked.map((t) => t.row.rowIndex)).toEqual([7]);
});

test("planSkipMarks: 別の印が付いている行には重ねて追記する", () => {
  const marked = [makeRow({ rowIndex: 8, companyUrl: "https://alpha.example.com/", note: "CAPTCHA" })];
  const plan = planSkipMarks("https://alpha.example.com/", marked, NEVER_SEND_MARKER);
  expect(plan.targets[0].newNote).toBe(`CAPTCHA / ${NEVER_SEND_MARKER}`);
});

test("planSkipMarks: どの行にも一致しないURLはunmatchedとして返す(黙って捨てない)", () => {
  const plan = planSkipMarks("https://unknown.example.org/contact", rows, NEVER_SEND_MARKER);
  expect(plan.targets).toEqual([]);
  expect(plan.unmatched).toEqual(["https://unknown.example.org/contact"]);
});

test("planSkipMarks: 1つのURLが複数行に一致したら書き込まずambiguousに入れる", () => {
  const sameHost = [
    makeRow({ rowIndex: 2, companyName: "アルファ事業部", companyUrl: "https://shared.example.com/a" }),
    makeRow({ rowIndex: 3, companyName: "アルファ商事", companyUrl: "https://shared.example.com/b" }),
  ];
  const plan = planSkipMarks("https://shared.example.com/other", sameHost, NEVER_SEND_MARKER);
  expect(plan.targets).toEqual([]);
  expect(plan.ambiguous).toEqual([
    { url: "https://shared.example.com/other", rows: sameHost },
  ]);
});

test("planSkipMarks: 同じ行を指すURLを複数貼っても1回しか書き込まない", () => {
  const plan = planSkipMarks("https://beta.example.jp/company/ https://beta.example.jp/inquiry/", rows, NEVER_SEND_MARKER);
  expect(plan.targets.map((t) => t.row.rowIndex)).toEqual([3]);
});

test("resolveSkipReason: 既定は送信NG", () => {
  expect(resolveSkipReason(undefined)).toBe(NEVER_SEND_MARKER);
});

test("resolveSkipReason: シートで効くスキップ印だけを受け付ける", () => {
  expect(resolveSkipReason("CAPTCHA")).toBe("CAPTCHA");
  expect(resolveSkipReason("フォーム無")).toBe("フォーム無");
  // 効かない印を書いてしまうと、スキップしたつもりの企業に送信してしまう
  expect(() => resolveSkipReason("送信不可")).toThrow(/送信NG/);
});

test("parseSkipMarkArgs: URLとオプションを分けて取り出す", () => {
  expect(parseSkipMarkArgs(["https://a.example.com", "https://b.example.com", "--apply"])).toEqual({
    urls: "https://a.example.com https://b.example.com",
    reason: undefined,
    apply: true,
  });
});

test("parseSkipMarkArgs: --reason は空白区切りでもイコール区切りでも受け付ける", () => {
  expect(parseSkipMarkArgs(["--reason", "CAPTCHA", "https://a.example.com"]).reason).toBe("CAPTCHA");
  expect(parseSkipMarkArgs(["--reason=CAPTCHA", "https://a.example.com"]).reason).toBe("CAPTCHA");
});

test("parseSkipMarkArgs: --apply がなければ書き込まない", () => {
  expect(parseSkipMarkArgs(["https://a.example.com"]).apply).toBe(false);
});

test("parseSkipMarkArgs: --reason の値がなければエラーにする(URLと取り違えない)", () => {
  expect(() => parseSkipMarkArgs(["https://a.example.com", "--reason"])).toThrow(/--reason/);
});

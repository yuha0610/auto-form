import { test, expect } from "@playwright/test";
import { parseRecordEntries, planOutcomeRecords } from "../src/lib/outcomeRecording.js";
import { COLUMNS, type SheetRowData } from "../src/types.js";

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

const TODAY = new Date(2026, 7, 26);

function valueOf(writes: { columnName: string; value: string }[], columnName: string): string | undefined {
  return writes.find((write) => write.columnName === columnName)?.value;
}

test("sent: 送信日を1回目に記録し、備考から「フォーム無」を外す", () => {
  const rows = [makeRow({ note: "要確認 / フォーム無(要確認)" })];
  const plan = planOutcomeRecords([{ url: "https://example.com/", outcome: "sent" }], rows, TODAY);
  expect(plan.errors).toEqual([]);
  const writes = plan.targets[0].writes;
  expect(valueOf(writes, COLUMNS.firstSent)).toBe("2026/08/26");
  expect(valueOf(writes, COLUMNS.note)).toBe("要確認");
});

test("sent: 1回目が埋まっていれば2回目に記録する", () => {
  const rows = [makeRow({ firstSentAt: "2026/07/13" })];
  const plan = planOutcomeRecords([{ url: "https://example.com/", outcome: "sent" }], rows, TODAY);
  const writes = plan.targets[0].writes;
  expect(valueOf(writes, COLUMNS.secondSent)).toBe("2026/08/26");
  expect(valueOf(writes, COLUMNS.firstSent)).toBeUndefined();
});

test("sent: 3回とも送信済みなら書き込まずエラーとして返す", () => {
  const rows = [
    makeRow({ firstSentAt: "2026/07/13", secondSentAt: "2026/08/07", thirdSentAt: "2026/08/25" }),
  ];
  const plan = planOutcomeRecords([{ url: "https://example.com/", outcome: "sent" }], rows, TODAY);
  expect(plan.targets).toEqual([]);
  expect(plan.errors[0].message).toMatch(/3回/);
});

test("sent: フォームURLが渡されれば一緒に保存する", () => {
  const rows = [makeRow({})];
  const plan = planOutcomeRecords(
    [{ url: "https://example.com/", outcome: "sent", formUrl: "https://other.example/contact" }],
    rows,
    TODAY,
  );
  expect(valueOf(plan.targets[0].writes, COLUMNS.formUrl)).toBe("https://other.example/contact");
});

test("email: メール列と備考「メール」を書き、送信日は記録しない", () => {
  const rows = [makeRow({ note: "フォーム無" })];
  const plan = planOutcomeRecords(
    [{ url: "https://example.com/", outcome: "email", email: "info@example.com" }],
    rows,
    TODAY,
  );
  const writes = plan.targets[0].writes;
  expect(valueOf(writes, COLUMNS.email)).toBe("info@example.com");
  expect(valueOf(writes, COLUMNS.note)).toBe("メール");
  expect(valueOf(writes, COLUMNS.firstSent)).toBeUndefined();
});

test("email: すでに入っているメールアドレスは上書きしない", () => {
  const rows = [makeRow({ email: "sales@example.com" })];
  const plan = planOutcomeRecords(
    [{ url: "https://example.com/", outcome: "email", email: "info@example.com" }],
    rows,
    TODAY,
  );
  expect(valueOf(plan.targets[0].writes, COLUMNS.email)).toBeUndefined();
});

test("email: メールアドレスが無ければエラーにする", () => {
  const plan = planOutcomeRecords([{ url: "https://example.com/", outcome: "email" }], [makeRow({})], TODAY);
  expect(plan.targets).toEqual([]);
  expect(plan.errors[0].message).toMatch(/email/);
});

test("failed: 備考に「送信失敗」を追記する", () => {
  const rows = [makeRow({ note: "要確認 / フォーム無" })];
  const plan = planOutcomeRecords([{ url: "https://example.com/", outcome: "failed" }], rows, TODAY);
  expect(valueOf(plan.targets[0].writes, COLUMNS.note)).toBe("要確認 / 送信失敗");
});

test("skip: 指定した印を追記する", () => {
  const rows = [makeRow({ note: "フォーム無" })];
  const plan = planOutcomeRecords(
    [{ url: "https://example.com/", outcome: "skip", reason: "リンク切れ" }],
    rows,
    TODAY,
  );
  expect(valueOf(plan.targets[0].writes, COLUMNS.note)).toBe("リンク切れ");
});

test("skip: すでに同じ印があれば書き込み対象にしない", () => {
  const rows = [makeRow({ note: "送信NG" })];
  const plan = planOutcomeRecords(
    [{ url: "https://example.com/", outcome: "skip", reason: "送信NG" }],
    rows,
    TODAY,
  );
  expect(plan.targets).toEqual([]);
  expect(plan.alreadyDone).toHaveLength(1);
});

test("skip: シートで効かない印はエラーにする", () => {
  const plan = planOutcomeRecords(
    [{ url: "https://example.com/", outcome: "skip", reason: "送信不可" }],
    [makeRow({})],
    TODAY,
  );
  expect(plan.targets).toEqual([]);
  expect(plan.errors[0].message).toMatch(/送信NG/);
});

test("form-url: フォームURLだけ更新し、「フォーム無」を外す", () => {
  const rows = [makeRow({ note: "フォーム無(要確認)" })];
  const plan = planOutcomeRecords(
    [{ url: "https://example.com/", outcome: "form-url", formUrl: "https://example.com/contact" }],
    rows,
    TODAY,
  );
  const writes = plan.targets[0].writes;
  expect(valueOf(writes, COLUMNS.formUrl)).toBe("https://example.com/contact");
  expect(valueOf(writes, COLUMNS.note)).toBe("");
  expect(valueOf(writes, COLUMNS.firstSent)).toBeUndefined();
});

test("どの行にも一致しないURLはunmatchedとして返す", () => {
  const plan = planOutcomeRecords(
    [{ url: "https://unknown.example.org/", outcome: "sent" }],
    [makeRow({})],
    TODAY,
  );
  expect(plan.unmatched).toEqual(["https://unknown.example.org/"]);
});

test("複数行に一致するURLは書き込まずambiguousとして返す", () => {
  const rows = [
    makeRow({ rowIndex: 2, companyUrl: "https://shared.example.com/a" }),
    makeRow({ rowIndex: 3, companyUrl: "https://shared.example.com/b" }),
  ];
  const plan = planOutcomeRecords(
    [{ url: "https://shared.example.com/other", outcome: "sent" }],
    rows,
    TODAY,
  );
  expect(plan.targets).toEqual([]);
  expect(plan.ambiguous).toHaveLength(1);
});

test("同じ行を指すエントリが2つあればエラーにする(取り違えを防ぐ)", () => {
  const rows = [makeRow({ companyUrl: "https://example.com/", formUrl: "https://example.com/contact" })];
  const plan = planOutcomeRecords(
    [
      { url: "https://example.com/", outcome: "sent" },
      { url: "https://example.com/contact", outcome: "failed" },
    ],
    rows,
    TODAY,
  );
  expect(plan.targets).toHaveLength(1);
  expect(plan.errors[0].message).toMatch(/重複/);
});

test("parseRecordEntries: 必要な項目が揃っていれば読み込める", () => {
  const entries = parseRecordEntries(
    JSON.stringify([{ url: "https://example.com/", outcome: "sent", formUrl: "https://example.com/contact" }]),
  );
  expect(entries).toEqual([
    { url: "https://example.com/", outcome: "sent", formUrl: "https://example.com/contact" },
  ]);
});

test("parseRecordEntries: 知らないoutcomeは読み込み時にエラーにする", () => {
  expect(() => parseRecordEntries(JSON.stringify([{ url: "https://example.com/", outcome: "送った" }]))).toThrow(
    /outcome/,
  );
});

test("parseRecordEntries: 配列でなければエラーにする", () => {
  expect(() => parseRecordEntries(JSON.stringify({ url: "https://example.com/" }))).toThrow(/配列/);
});

test("parseRecordEntries: URLが無ければエラーにする", () => {
  expect(() => parseRecordEntries(JSON.stringify([{ outcome: "sent" }]))).toThrow(/url/);
});

test("email: すでに「メール」が付いていれば重ねて追記しない", () => {
  const rows = [makeRow({ note: "メール", email: "info@example.com" })];
  const plan = planOutcomeRecords(
    [{ url: "https://example.com/", outcome: "email", email: "info@example.com" }],
    rows,
    TODAY,
  );
  expect(plan.targets).toEqual([]);
  expect(plan.alreadyDone).toHaveLength(1);
});

test("email: 印が付いていてもメールアドレスが未登録なら保存する", () => {
  const rows = [makeRow({ note: "メール" })];
  const plan = planOutcomeRecords(
    [{ url: "https://example.com/", outcome: "email", email: "info@example.com" }],
    rows,
    TODAY,
  );
  expect(valueOf(plan.targets[0].writes, COLUMNS.email)).toBe("info@example.com");
  expect(valueOf(plan.targets[0].writes, COLUMNS.note)).toBeUndefined();
});

test("failed: すでに「送信失敗」が付いていれば重ねて追記しない", () => {
  const rows = [makeRow({ note: "送信失敗" })];
  const plan = planOutcomeRecords([{ url: "https://example.com/", outcome: "failed" }], rows, TODAY);
  expect(plan.targets).toEqual([]);
  expect(plan.alreadyDone).toHaveLength(1);
});

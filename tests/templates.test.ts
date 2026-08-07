import { test, expect } from "@playwright/test";
import { renderTemplate } from "../src/lib/templates.js";
import type { Template } from "../src/types.js";

const baseTemplate: Template = {
  name: "test",
  senderCompany: "株式会社スタートアップクラス",
  senderName: "川勝 由羽",
  senderEmail: "kawakatsu.yuha@amateras2011.jp",
  senderPhone: "050-5879-7845",
  senderTitle: "事業推進部",
  subject: "{{companyName}}様へ|ご案内",
  message: "{{companyName}}様のプロダクトを拝見し、ご連絡しました。{{companyName}}様のご発展を願っております。",
};

test("renderTemplate: subjectとmessage内の{{companyName}}を企業名に置換する", () => {
  const result = renderTemplate(baseTemplate, "テスト株式会社");

  expect(result.subject).toBe("テスト株式会社様へ|ご案内");
  expect(result.message).toBe(
    "テスト株式会社様のプロダクトを拝見し、ご連絡しました。テスト株式会社様のご発展を願っております。",
  );
});

test("renderTemplate: 企業名が空文字の場合は「貴社」に置換する", () => {
  const result = renderTemplate(baseTemplate, "");

  expect(result.subject).toBe("貴社様へ|ご案内");
});

test("renderTemplate: senderCompany等の他フィールドは変更しない", () => {
  const result = renderTemplate(baseTemplate, "テスト株式会社");

  expect(result.senderCompany).toBe(baseTemplate.senderCompany);
  expect(result.senderName).toBe(baseTemplate.senderName);
  expect(result.senderEmail).toBe(baseTemplate.senderEmail);
  expect(result.senderPhone).toBe(baseTemplate.senderPhone);
  expect(result.senderTitle).toBe(baseTemplate.senderTitle);
});

test("renderTemplate: プレースホルダーを含まない文面はそのまま返す", () => {
  const template: Template = { ...baseTemplate, subject: "固定件名", message: "固定本文" };
  const result = renderTemplate(template, "テスト株式会社");

  expect(result.subject).toBe("固定件名");
  expect(result.message).toBe("固定本文");
});

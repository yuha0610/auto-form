import type { Page } from "playwright";
import type { Template } from "../types.js";

/**
 * フィールドラベル/name/placeholder に含まれるキーワードから入力欄を推測するための対応表。
 * サイトごとにフォーム構造が異なるため、完全自動化はできず推測ベースになる。
 */
const FIELD_KEYWORDS: Record<keyof Pick<
  Template,
  "senderCompany" | "senderName" | "senderEmail" | "senderPhone" | "subject" | "message"
>, string[]> = {
  senderCompany: ["会社名", "貴社名", "company", "corporation"],
  senderName: ["氏名", "お名前", "担当者名", "name"],
  senderEmail: ["メール", "email", "mail"],
  senderPhone: ["電話", "tel", "phone"],
  subject: ["件名", "タイトル", "subject"],
  message: ["お問い合わせ内容", "本文", "message", "inquiry", "content"],
};

async function fillByKeyword(page: Page, keywords: string[], value: string): Promise<boolean> {
  const inputs = page.locator("input, textarea");
  const count = await inputs.count();

  for (let i = 0; i < count; i++) {
    const input = inputs.nth(i);
    const attrs = await input.evaluate((el) => {
      const label = el.closest("label")?.textContent ?? "";
      const id = el.getAttribute("id") ?? "";
      const labelFor = id
        ? document.querySelector(`label[for="${id}"]`)?.textContent ?? ""
        : "";
      return {
        name: el.getAttribute("name") ?? "",
        placeholder: el.getAttribute("placeholder") ?? "",
        label: `${label} ${labelFor}`,
      };
    });

    const haystack = `${attrs.name} ${attrs.placeholder} ${attrs.label}`.toLowerCase();
    if (keywords.some((k) => haystack.includes(k.toLowerCase()))) {
      await input.fill(value);
      return true;
    }
  }
  return false;
}

export interface FillResult {
  filledFields: string[];
  missingFields: string[];
}

/** フォームへテンプレートの内容を推測入力する。送信ボタンのクリックは行わない。 */
export async function fillForm(page: Page, template: Template): Promise<FillResult> {
  const filledFields: string[] = [];
  const missingFields: string[] = [];

  const entries: [keyof typeof FIELD_KEYWORDS, string][] = [
    ["senderCompany", template.senderCompany],
    ["senderName", template.senderName],
    ["senderEmail", template.senderEmail],
    ["senderPhone", template.senderPhone],
    ["subject", template.subject],
    ["message", template.message],
  ];

  for (const [field, value] of entries) {
    const filled = await fillByKeyword(page, FIELD_KEYWORDS[field], value);
    (filled ? filledFields : missingFields).push(field);
  }

  return { filledFields, missingFields };
}

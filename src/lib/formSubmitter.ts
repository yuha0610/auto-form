import type { Page } from "playwright";
import type { Template } from "../types.js";

/**
 * フィールドラベル/name/placeholder に含まれるキーワードから入力欄を推測するための対応表。
 * サイトごとにフォーム構造が異なるため、完全自動化はできず推測ベースになる。
 */
const FIELD_KEYWORDS: Record<keyof Pick<
  Template,
  "senderCompany" | "senderName" | "senderEmail" | "senderPhone" | "senderTitle" | "subject" | "message"
>, string[]> = {
  senderCompany: ["会社名", "貴社名", "企業名", "company", "corporation"],
  senderName: ["氏名", "お名前", "担当者名", "name"],
  senderEmail: ["メール", "email", "mail"],
  senderPhone: ["電話", "tel", "phone"],
  senderTitle: ["役職", "肩書", "job title", "position"],
  subject: ["件名", "タイトル", "subject"],
  message: ["お問い合わせ内容", "お問い合せ内容", "本文", "message", "inquiry", "content"],
};

const NON_FILLABLE_INPUT_TYPES = ["hidden", "button", "submit", "reset", "checkbox", "radio", "image", "file"];

async function fillByKeyword(page: Page, keywords: string[], value: string): Promise<boolean> {
  const excluded = NON_FILLABLE_INPUT_TYPES.map((t) => `:not([type='${t}'])`).join("");
  const inputs = page.locator(`input${excluded}, textarea`);
  const count = await inputs.count();

  for (let i = 0; i < count; i++) {
    const input = inputs.nth(i);
    const attrs = await input.evaluate((el) => {
      const label = el.closest("label")?.textContent ?? "";
      const id = el.getAttribute("id") ?? "";
      const labelFor = id
        ? document.querySelector(`label[for="${id}"]`)?.textContent ?? ""
        : "";

      // label要素と紐づいていない入力欄向けに、直前の兄弟要素や親要素内の
      // テキストを見出しテキストの代わりとして拾うフォールバック。
      // script/style/noscriptやhidden inputは表示上のラベルになり得ないので除外する。
      const NON_LABEL_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT", "SCRIPT", "STYLE", "NOSCRIPT"]);
      let nearby = "";
      if (!label && !labelFor) {
        let node: Element = el;
        for (let depth = 0; depth < 3; depth++) {
          const container: Element | null = node.parentElement;
          if (!container) break;

          let text = "";
          for (const child of Array.from(container.children)) {
            if (child === node) break;
            if (NON_LABEL_TAGS.has(child.tagName)) continue;
            text += ` ${child.textContent ?? ""}`;
          }
          if (text.trim()) {
            nearby = text;
            break;
          }
          node = container;
        }
      }

      return {
        name: el.getAttribute("name") ?? "",
        placeholder: el.getAttribute("placeholder") ?? "",
        label: `${label} ${labelFor} ${nearby}`,
      };
    });

    const haystack = `${attrs.name} ${attrs.placeholder} ${attrs.label}`.toLowerCase();
    if (keywords.some((k) => haystack.includes(k.toLowerCase()))) {
      // 非表示要素は表示されるまで最大30秒待ってしまうため、
      // 事前にisVisible()で即判定して無駄な待機を避ける。
      if (!(await input.isVisible())) {
        continue;
      }
      try {
        await input.fill(value, { timeout: 5000 });
        return true;
      } catch (error) {
        console.warn(`入力欄への入力に失敗したためスキップします: ${String(error)}`);
      }
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
  if (template.senderTitle) {
    entries.push(["senderTitle", template.senderTitle]);
  }

  for (const [field, value] of entries) {
    const filled = await fillByKeyword(page, FIELD_KEYWORDS[field], value);
    (filled ? filledFields : missingFields).push(field);
  }

  return { filledFields, missingFields };
}

const FIELD_LABELS: Record<string, string> = {
  senderCompany: "会社名",
  senderName: "氏名",
  senderEmail: "メール",
  senderPhone: "電話",
  senderTitle: "役職",
  subject: "件名",
  message: "本文",
};

export async function injectFillBanner(
  page: Page,
  filledFields: string[],
  missingFields: string[],
): Promise<void> {
  const summary = [
    ...filledFields.map((field) => `${FIELD_LABELS[field] ?? field}○`),
    ...missingFields.map((field) => `${FIELD_LABELS[field] ?? field}✗`),
  ].join(" ");

  await page.evaluate((text) => {
    const banner = document.createElement("div");
    banner.textContent = `自動入力: ${text}`;
    banner.setAttribute("data-auto-form-banner", "true");
    Object.assign(banner.style, {
      position: "fixed",
      top: "0",
      left: "0",
      zIndex: "999999",
      background: "#222",
      color: "#fff",
      padding: "6px 12px",
      fontSize: "12px",
      fontFamily: "sans-serif",
    });
    document.body.prepend(banner);
  }, summary);
}

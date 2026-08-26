import type { Page } from "playwright";
import type { Template } from "../types.js";
import { fillForm, type FillResult } from "./formSubmitter.js";
import { findContactLink } from "./formDiscovery.js";
import { gotoWithRetry } from "./navigation.js";

export interface FillFlowResult extends FillResult {
  /** 案内ページ等から実フォームへ追加で遷移した場合、その遷移先URL */
  navigatedTo?: string;
}

/**
 * まず現在のページで入力を試み、1件も入力できなかった場合のみ
 * ページ内のリンクから実フォームをもう一段階だけ探して遷移・再試行する。
 * サイトによっては「案内ページ→お問い合わせフォーム」の2段階構成になっているため。
 */
export async function fillFormWithDiscovery(
  page: Page,
  template: Template,
): Promise<FillFlowResult> {
  const result = await fillForm(page, template);
  if (result.filledFields.length > 0) {
    return result;
  }

  // 遷移して入力し直せるのは別ページのフォームだけ。同じページ・メール・Google Formは
  // ここで遷移しても状況が変わらないので、最初の結果をそのまま返す。
  const nested = await findContactLink(page);
  if (!nested || nested.kind !== "form" || nested.url === page.url()) {
    return result;
  }
  const nestedUrl = nested.url;

  await gotoWithRetry(page, nestedUrl, { waitUntil: "domcontentloaded" });
  const retryResult = await fillForm(page, template);
  if (retryResult.filledFields.length === 0) {
    return result;
  }

  return { ...retryResult, navigatedTo: nestedUrl };
}

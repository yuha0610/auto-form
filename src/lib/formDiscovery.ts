import type { Page } from "playwright";

const CONTACT_LINK_KEYWORDS = ["お問い合わせ", "お問合せ", "contact", "inquiry"];

/** JS描画のサイトで、1回目の走査時点ではリンクがまだDOMに無いことがあるため待ち直す上限 */
const RESCAN_TIMEOUT_MS = 5_000;

/** 問い合わせリンクの行き先。送信できる形かどうかで呼び出し側の扱いが変わる。 */
export type ContactLink =
  /** 別ページのお問い合わせフォーム */
  | { kind: "form"; url: string }
  /** 今いるページ自身にフォームがある(ページ内アンカーやダミーリンク) */
  | { kind: "same-page"; url: string }
  /** 問い合わせ先がメールアドレスだった */
  | { kind: "email"; address: string }
  /** Google Form。自動入力できないので通常のフォームと区別する */
  | { kind: "google-form"; url: string };

export function extractMailto(href: string): string | null {
  if (!href.toLowerCase().startsWith("mailto:")) return null;
  const address = href.slice("mailto:".length).split("?")[0];
  return address || null;
}

function isGoogleForm(url: URL): boolean {
  if (url.host === "forms.gle") return true;
  return url.host.endsWith("google.com") && url.pathname.includes("/forms/");
}

function withoutHash(url: URL): string {
  return `${url.origin}${url.pathname}${url.search}`;
}

/**
 * リンクの行き先を、送信できる形かどうかで分類する。
 * `href`はDOM側で絶対URLに解決済みの値を想定する。
 */
export function classifyContactHref(href: string, pageUrl: string): ContactLink | null {
  const address = extractMailto(href);
  if (address) return { kind: "email", address };

  let url: URL;
  let current: URL;
  try {
    url = new URL(href);
    current = new URL(pageUrl);
  } catch {
    return null;
  }
  // tel: や javascript: は問い合わせフォームの行き先にならない
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  if (isGoogleForm(url)) return { kind: "google-form", url: href };

  // 「#form」のようなページ内アンカーやダミーリンクは、そのページ自体にフォームがある
  if (withoutHash(url) === withoutHash(current)) return { kind: "same-page", url: pageUrl };

  return { kind: "form", url: href };
}

interface RawLink {
  text: string;
  href: string;
}

/**
 * ページ内のリンクを読み出す。
 * `innerText`は非表示要素で空文字を返し、ハンバーガーメニューに畳まれた
 * お問い合わせリンクを取り逃がすため、`textContent`で表示状態に関係なく読む。
 */
async function readLinks(page: Page): Promise<RawLink[]> {
  return page
    .$$eval("a[href]", (elements) =>
      elements.map((el) => ({
        text: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
        href: (el as HTMLAnchorElement).href,
      })),
    )
    .catch(() => []);
}

function pickContactLink(links: RawLink[], pageUrl: string): ContactLink | null {
  const found: ContactLink[] = [];
  for (const link of links) {
    let decodedHref = link.href;
    try {
      decodedHref = decodeURIComponent(link.href);
    } catch {
      // 不正なエスケープを含むURLはそのまま照合する
    }
    const haystack = `${link.text} ${decodedHref}`.toLowerCase();
    if (!CONTACT_LINK_KEYWORDS.some((keyword) => haystack.includes(keyword.toLowerCase()))) {
      continue;
    }
    const classified = classifyContactHref(link.href, pageUrl);
    if (classified) found.push(classified);
  }

  // 自動入力できる通常のフォームを優先する。メールやGoogle Formのリンクが
  // 先に並んでいるだけで、下に本来のフォームがあるサイトを取りこぼさないため。
  return found.find((link) => link.kind === "form" || link.kind === "same-page") ?? found[0] ?? null;
}

/** トップページから問い合わせ導線を探す。見つからなければnull。 */
export async function findContactLink(page: Page): Promise<ContactLink | null> {
  const first = pickContactLink(await readLinks(page), page.url());
  if (first) return first;

  // 描画が遅いサイト向けに、見つからなかったときだけリンクが現れるのを待って探し直す。
  // `networkidle`では通信が止まった後に描画されるリンクを待てないので、リンク自体を待つ。
  await page
    .waitForFunction(
      (keywords: string[]) =>
        [...document.querySelectorAll("a[href]")].some((el) => {
          const href = (el as HTMLAnchorElement).href;
          let decoded = href;
          try {
            decoded = decodeURIComponent(href);
          } catch {
            // 不正なエスケープを含むURLはそのまま照合する
          }
          const haystack = `${el.textContent ?? ""} ${decoded}`.toLowerCase();
          return keywords.some((keyword) => haystack.includes(keyword));
        }),
      CONTACT_LINK_KEYWORDS.map((keyword) => keyword.toLowerCase()),
      { timeout: RESCAN_TIMEOUT_MS },
    )
    .catch(() => {
      // 時間内に現れなければ、その時点の内容で判断する
    });
  return pickContactLink(await readLinks(page), page.url());
}

import type { Page } from "playwright";

const CONTACT_LINK_KEYWORDS = ["お問い合わせ", "お問合せ", "contact", "inquiry"];

export async function findContactFormUrl(page: Page): Promise<string | null> {
  const links = page.locator("a");
  const count = await links.count();

  for (let i = 0; i < count; i++) {
    const link = links.nth(i);
    const text = await link.innerText().catch(() => "");
    const href = await link
      .evaluate((el) => (el as HTMLAnchorElement).href)
      .catch(() => "");

    if (!href) continue;

    const haystack = `${text} ${href}`.toLowerCase();
    if (CONTACT_LINK_KEYWORDS.some((keyword) => haystack.includes(keyword.toLowerCase()))) {
      return href;
    }
  }

  return null;
}

export function extractMailto(href: string): string | null {
  if (!href.toLowerCase().startsWith("mailto:")) return null;
  const address = href.slice("mailto:".length).split("?")[0];
  return address || null;
}

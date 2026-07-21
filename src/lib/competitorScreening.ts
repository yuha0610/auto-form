export const COMPETITOR_KEYWORDS = [
  "人材紹介",
  "人材派遣",
  "人材バンク",
  "人材サービス",
  "採用支援",
  "採用代行",
  "採用アウトソーシング",
  "採用マーケティング",
  "RPO",
  "BPO",
  "アウトソーシング",
  "ヘッドハンティング",
  "エグゼクティブサーチ",
  "人事コンサル",
  "人事コンサルティング",
];

export function matchCompanyName(companyName: string): string | null {
  return COMPETITOR_KEYWORDS.find((keyword) => companyName.includes(keyword)) ?? null;
}

export interface PageContentMatch {
  keyword: string;
  snippet: string;
}

export function matchPageContent(text: string): PageContentMatch | null {
  for (const keyword of COMPETITOR_KEYWORDS) {
    const idx = text.indexOf(keyword);
    if (idx !== -1) {
      const snippet = text
        .slice(Math.max(0, idx - 30), idx + keyword.length + 30)
        .replace(/\s+/g, " ");
      return { keyword, snippet };
    }
  }
  return null;
}

const OVERVIEW_LINK_RE =
  /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]{0,40}(?:会社概要|会社情報|企業情報|事業内容|事業紹介|サービス|IR情報|投資家情報|About\s*Us|Company)[^<]{0,10})<\/a>/gi;

export function resolveOverviewUrl(baseUrl: string, html: string): string | null {
  const match = [...html.matchAll(OVERVIEW_LINK_RE)][0];
  if (!match) return null;

  let resolved: URL;
  try {
    resolved = new URL(match[1], baseUrl);
  } catch {
    return null;
  }

  if (resolved.hash) return null;

  return resolved.toString();
}

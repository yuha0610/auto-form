export const NON_STARTUP_KEYWORDS = [
  "学習塾",
  "個別指導塾",
  "進学塾",
  "予備校",
  "家庭教師",
  "資格スクール",
  "資格予備校",
  "自習室",
  "セミナー事業",
];

export function matchCompanyName(companyName: string): string | null {
  return NON_STARTUP_KEYWORDS.find((keyword) => companyName.includes(keyword)) ?? null;
}

export interface PageContentMatch {
  keyword: string;
  snippet: string;
}

export function matchPageContent(text: string): PageContentMatch | null {
  for (const keyword of NON_STARTUP_KEYWORDS) {
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

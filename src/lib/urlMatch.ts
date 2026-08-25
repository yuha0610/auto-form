export interface UrlCandidate {
  /** 呼び出し側が結果を紐付けるためのキー(行番号やバッチ内の位置など) */
  key: number;
  /** この候補を指すと判断できるURL(フォームURL・企業URLなど) */
  urls: string[];
}

export interface UrlPairing {
  key: number;
  /** 貼り付けられたURLそのもの。フォームURLとして保存する用途にも使える。 */
  url: string;
}

export interface PastedUrlMatch {
  matches: UrlPairing[];
  /** どの候補にも紐付けられなかった入力。黙って捨てず呼び出し側に返す。 */
  unmatched: string[];
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

function hostOf(url: string): string | null {
  try {
    return new URL(url.trim()).host.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** カンマ・空白・改行のいずれの区切りでも受け付ける。 */
export function splitUrlInput(input: string): string[] {
  return input
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

/**
 * 1つのURLに一致する候補をすべて返す。
 * 完全一致を優先し、見つからなければホスト一致で拾う
 * (確認中にサイト内を移動してURLが変わっていても同じ企業と判断できるようにするため)。
 * ホスト一致が複数あると同じホストを共有する別会社を取り違えかねないので、
 * 1つに絞らず呼び出し側に判断を委ねる。
 */
export function findUrlMatches(url: string, candidates: UrlCandidate[]): UrlCandidate[] {
  const normalized = normalizeUrl(url);
  const exact = candidates.filter((candidate) =>
    candidate.urls.some((candidateUrl) => normalizeUrl(candidateUrl) === normalized),
  );
  if (exact.length > 0) return exact;

  const host = hostOf(url);
  if (!host) return [];
  return candidates.filter((candidate) =>
    candidate.urls.some((candidateUrl) => hostOf(candidateUrl) === host),
  );
}

/**
 * 貼り付けられたURLを候補に突き合わせる。
 * 一致が複数あるときは最初の候補を採用する。
 */
export function matchPastedUrls(input: string, candidates: UrlCandidate[]): PastedUrlMatch {
  const matches: UrlPairing[] = [];
  const unmatched: string[] = [];

  for (const pasted of splitUrlInput(input)) {
    const matched = findUrlMatches(pasted, candidates)[0];

    if (!matched) {
      unmatched.push(pasted);
      continue;
    }
    // 同じ企業に複数貼られた場合は最初のものを採用する
    if (!matches.some((pairing) => pairing.key === matched.key)) {
      matches.push({ key: matched.key, url: pasted });
    }
  }

  return { matches, unmatched };
}

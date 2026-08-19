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
function splitInput(input: string): string[] {
  return input
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

/**
 * 貼り付けられたURLを候補に突き合わせる。
 * 完全一致を優先し、見つからなければホスト一致で拾う
 * (確認中にサイト内を移動してURLが変わっていても同じ企業と判断できるようにするため)。
 */
export function matchPastedUrls(input: string, candidates: UrlCandidate[]): PastedUrlMatch {
  const matches: UrlPairing[] = [];
  const unmatched: string[] = [];

  for (const pasted of splitInput(input)) {
    const normalized = normalizeUrl(pasted);
    let matched = candidates.find((candidate) =>
      candidate.urls.some((url) => normalizeUrl(url) === normalized),
    );

    if (!matched) {
      const host = hostOf(pasted);
      if (host) {
        matched = candidates.find((candidate) =>
          candidate.urls.some((url) => hostOf(url) === host),
        );
      }
    }

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

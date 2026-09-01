import { extractCompanyCoreName } from "./textNormalize.js";
import type { SheetRowData } from "../types.js";

/**
 * 同じドメインを指している行を重複候補として洗い出す。
 *
 * `groupByCoreName`は企業名のコア名で突き合わせるため、社名変更で旧社名と新社名の
 * コア名が変わったペア(ストリーツ株式会社 / StoryHub株式会社 など)を原理的に拾えない。
 * ドメインが一致すれば社名が違っても同一企業なので、その観点で重複を探す。
 */

/**
 * 複数の企業が同じホストを共有しうるサービス。
 * ホストが一致しただけでは同一企業の証拠にならないので、完全URLの一致でだけ突き合わせる。
 */
const SHARED_HOSTS = [
  "wixsite.com",
  "wixstudio.io",
  "studio.site",
  "squarespace.com",
  "shopify.com",
  "myshopify.com",
  "notion.site",
  "wraptas.site",
  "hubspotpagebuilder.com",
  "share.hsforms.com",
  "google.com",
  "docs.google.com",
  "forms.gle",
  "form.run",
  "tayori.com",
  "prtimes.jp",
  "peraichi.com",
  "wantedly.com",
  "herp.careers",
  "lit.link",
  "base.shop",
  "amebaownd.com",
  "jimdofree.com",
  "jimdosite.com",
  "webflow.io",
  "framer.website",
  "netlify.app",
  "vercel.app",
  "github.io",
  "sakura.ne.jp",
  "xsrv.jp",
];

export interface DomainDuplicateGroup {
  /** 突き合わせに使ったキー。ホスト名、または共有サービスの場合は `url:` 付きの正規化URL。 */
  key: string;
  /** グループ内の企業名のコア名がすべて同じか。falseなら`cleanup:company-names`では拾えない。 */
  sameCoreName: boolean;
  rows: SheetRowData[];
}

function isSharedHost(host: string): boolean {
  return SHARED_HOSTS.some((shared) => host === shared || host.endsWith(`.${shared}`));
}

/** 企業ごとに固有と言えるホストを返す。共有サービスのホストはnullを返す。 */
export function registrableHost(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  let host: string;
  try {
    host = new URL(trimmed).hostname.toLowerCase();
  } catch {
    return null;
  }
  host = host.replace(/^www\./, "");
  if (host === "" || isSharedHost(host)) return null;
  return host;
}

/**
 * 共有サービスのURLを完全一致で比較できる形に正規化する。
 * クエリを落とすとGoogle広告のクリックURLが全部同じに見えてしまうため、
 * クエリはキーの順に並べ替えたうえで残す。
 */
export function normalizeExactUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    const path = url.pathname.replace(/\/+$/, "");
    url.searchParams.sort();
    const query = url.searchParams.toString();
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return `${host}${path}${query === "" ? "" : `?${query}`}${url.hash}`;
  } catch {
    return null;
  }
}

/** 1行から突き合わせキーを取り出す(企業URL・フォームURLの両方を見る)。 */
function matchKeys(row: SheetRowData): Set<string> {
  const keys = new Set<string>();
  for (const raw of [row.companyUrl, row.formUrl]) {
    const host = registrableHost(raw);
    if (host !== null) {
      keys.add(host);
      continue;
    }
    const exact = normalizeExactUrl(raw);
    if (exact !== null) keys.add(`url:${exact}`);
  }
  return keys;
}

/**
 * 同じドメイン(または共有サービス上の同じURL)を指す行をグループにして返す。
 * 単独行はグループにしない。社名のコア名が違うグループを先に返す
 * (既存の重複判定で拾えないぶん、先に確認したいため)。
 */
export function findDomainDuplicates(rows: SheetRowData[]): DomainDuplicateGroup[] {
  const byKey = new Map<string, SheetRowData[]>();
  for (const row of rows) {
    for (const key of matchKeys(row)) {
      const list = byKey.get(key) ?? [];
      list.push(row);
      byKey.set(key, list);
    }
  }

  const groups: DomainDuplicateGroup[] = [];
  for (const [key, list] of byKey) {
    // 企業URLとフォームURLが同じキーになる行があるので、行番号で重複を落とす。
    const unique = [...new Map(list.map((row) => [row.rowIndex, row])).values()];
    if (unique.length < 2) continue;
    const coreNames = new Set(unique.map((row) => extractCompanyCoreName(row.companyName)));
    groups.push({
      key,
      sameCoreName: coreNames.size === 1,
      rows: unique.sort((a, b) => a.rowIndex - b.rowIndex),
    });
  }

  return groups.sort(
    (a, b) => Number(a.sameCoreName) - Number(b.sameCoreName) || a.key.localeCompare(b.key),
  );
}

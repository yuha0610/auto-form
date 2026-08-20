import type { SheetRowData } from "../types.js";
import { NEVER_SEND_MARKER } from "./targetSelection.js";
import { extractCompanyCoreName, normalizeCellText } from "./textNormalize.js";

export interface StarclaCompany {
  id: string;
  name: string;
  /** その企業がスタクラに掲載している求人の件数 */
  jobCount: number;
  /** 企業ページの「会社URL」。取得していない場合はundefined、記載が無い場合はnull */
  url?: string | null;
}

const JOB_CARD_REGEX = /<article class="cassetteCompany[\s\S]*?<\/article>/g;
const JOB_LINK_REGEX = /href="\/online\/companies\/(\d+)\/job_offers\/\d+\/"/;
const COMPANY_LINK_REGEX = /href="\/online\/companies\/(\d+)\/"/;
const COMPANY_NAME_REGEX = /<img[^>]*\balt="([^"]*)"/;
const PAGE_LINK_REGEX = /\?page=(\d+)/g;

function parseListingPage(html: string, linkRegex: RegExp): { id: string; name: string }[] {
  const entries: { id: string; name: string }[] = [];
  for (const card of html.match(JOB_CARD_REGEX) ?? []) {
    const link = card.match(linkRegex);
    if (!link) continue;
    const name = normalizeCellText(card.match(COMPANY_NAME_REGEX)?.[1] ?? "");
    if (!name) continue;
    entries.push({ id: link[1], name });
  }
  return entries;
}

/**
 * 求人一覧ページのHTMLから、求人カード1枚ごとの(企業ID・企業名)を取り出す。
 * 企業名はサムネイル画像のalt属性に入っている。
 */
export function parseJobListingPage(html: string): { id: string; name: string }[] {
  return parseListingPage(html, JOB_LINK_REGEX);
}

/** 企業一覧ページのHTMLから(企業ID・企業名)を取り出す。求人へのカードは対象外。 */
export function parseCompanyListingPage(html: string): { id: string; name: string }[] {
  return parseListingPage(html, COMPANY_LINK_REGEX);
}

const COMPANY_NAME_ROW_REGEX = /<th>\s*会社名\s*<\/th>\s*<td>([^<]*)<\/td>/;
const COMPANY_URL_ROW_REGEX = /<th>\s*会社URL\s*<\/th>\s*<td>\s*<a[^>]*\bhref="([^"]+)"/;

/** 企業ページの「会社概要」テーブルから、正式な会社名と会社URLを取り出す。 */
export function parseCompanyPage(html: string): { name: string; url: string | null } {
  return {
    name: normalizeCellText(html.match(COMPANY_NAME_ROW_REGEX)?.[1] ?? ""),
    url: html.match(COMPANY_URL_ROW_REGEX)?.[1] ?? null,
  };
}

/**
 * 複数の企業が共有するサービスのホスト。ここが一致しても同じ企業とは言えないため、
 * URL照合から除外する(例: フォームURLにtally.soが入っている行同士)。
 */
const SHARED_HOSTS = [
  // フォーム・アンケートサービス
  "tally.so",
  "forms.gle",
  "docs.google.com",
  "tayori.com",
  "formrun.io",
  "form.run",
  "hubspotpagebuilder.com",
  // サイト作成・ホスティング
  "studio.design",
  "notion.site",
  "note.com",
  "wixsite.com",
  "shopify.com",
  "peraichi.com",
  "jimdosite.com",
  "github.io",
  // プレスリリース・求人媒体(企業URL欄に入っていることがある)
  "prtimes.jp",
  "wantedly.com",
  "herp.careers",
  "en-gage.net",
];

function hostOf(url: string): string | null {
  try {
    const host = new URL(url.trim()).host.toLowerCase().replace(/^www\./, "");
    if (!host) return null;
    if (SHARED_HOSTS.some((shared) => host === shared || host.endsWith(`.${shared}`))) return null;
    return host;
  } catch {
    return null;
  }
}

/** ページネーションリンクから最終ページ番号を求める。リンクが無ければ1ページだけとみなす。 */
export function parseLastPageNumber(html: string): number {
  const pages = [...html.matchAll(PAGE_LINK_REGEX)].map((match) => Number(match[1]));
  return pages.length > 0 ? Math.max(...pages) : 1;
}

/** 求人単位の一覧を企業単位にまとめ、掲載求人件数を数える。並び順は最初に現れた順。 */
export function aggregateJobCompanies(entries: { id: string; name: string }[]): StarclaCompany[] {
  const companies = new Map<string, StarclaCompany>();
  for (const entry of entries) {
    const existing = companies.get(entry.id);
    if (existing) {
      existing.jobCount += 1;
      continue;
    }
    companies.set(entry.id, { id: entry.id, name: entry.name, jobCount: 1 });
  }
  return [...companies.values()];
}

const BRACKETED_REGEX = /[（(【「『]([^）)】」』]*)[）)】」』]/g;
const FORMER_NAME_LABEL_REGEX = /^(旧社名|旧名称|旧称|旧)\s*[：:]?\s*/;

/**
 * スタクラの社名欄には「Landit Inc. / ランディット株式会社」「エレビスタ（株）「〇〇」…」
 * 「OpenProp株式会社(旧社名:BIDHIT)」のように、併記・キャッチコピー・旧社名が
 * 混ざって入っていることがある。そのままではコア名が一致しないため、
 * 照合に使える社名の候補を列挙する。
 */
export function companyNameVariants(name: string): string[] {
  const variants = new Set<string>();
  const parts = name.split("/").map((part) => part.trim());
  for (const part of [name, ...parts]) {
    if (!part) continue;
    variants.add(part);
    variants.add(part.replace(BRACKETED_REGEX, " ").trim());
    variants.add(part.split(/[（(【「『]/)[0].trim());
    for (const bracketed of part.matchAll(BRACKETED_REGEX)) {
      variants.add(bracketed[1].replace(FORMER_NAME_LABEL_REGEX, "").trim());
    }
  }
  variants.delete("");
  return [...variants];
}

export interface StarclaMatch {
  company: StarclaCompany;
  row: SheetRowData;
}

export interface StarclaMatchResult {
  /** 備考に「送信NG」を追記する対象 */
  candidates: StarclaMatch[];
  /** すでに「送信NG」が付いている行(書き込み不要) */
  alreadyMarked: StarclaMatch[];
  /** 社名は一致するがURLのホストが食い違う行。同名の別会社の可能性があるため人が判断する */
  conflicts: StarclaMatch[];
}

/**
 * スタクラ掲載企業とシートの行を、法人格の表記ゆれを吸収したコア名で突き合わせる。
 * 同じコア名の行が複数あれば、そのすべてを結果に含める(どれが本命かは人が判断する)。
 */
export function matchStarclaCompanies(
  companies: StarclaCompany[],
  rows: SheetRowData[],
): StarclaMatchResult {
  const rowsByCore = new Map<string, SheetRowData[]>();
  const rowsByHost = new Map<string, SheetRowData[]>();
  for (const row of rows) {
    const core = extractCompanyCoreName(normalizeCellText(row.companyName));
    if (core) {
      if (!rowsByCore.has(core)) rowsByCore.set(core, []);
      rowsByCore.get(core)!.push(row);
    }
    for (const url of [row.companyUrl, row.formUrl]) {
      const host = hostOf(url);
      if (!host) continue;
      if (!rowsByHost.has(host)) rowsByHost.set(host, []);
      rowsByHost.get(host)!.push(row);
    }
  }

  const candidates: StarclaMatch[] = [];
  const alreadyMarked: StarclaMatch[] = [];
  const conflicts: StarclaMatch[] = [];
  for (const company of companies) {
    const companyHost = company.url ? hostOf(company.url) : null;
    const rowsMatchedByHost = companyHost ? (rowsByHost.get(companyHost) ?? []) : [];
    const matchedByHost = new Set(rowsMatchedByHost.map((row) => row.rowIndex));

    const rowsMatchedByName: SheetRowData[] = [];
    for (const variant of companyNameVariants(company.name)) {
      const core = extractCompanyCoreName(normalizeCellText(variant));
      if (core) rowsMatchedByName.push(...(rowsByCore.get(core) ?? []));
    }

    const seen = new Set<number>();
    for (const row of [...rowsMatchedByHost, ...rowsMatchedByName]) {
      // 別名やURLが同じ行を指すことがあるので、企業ごとに1行1回だけ数える
      if (seen.has(row.rowIndex)) continue;
      seen.add(row.rowIndex);
      const match = { company, row };

      // 社名しか一致しておらず、双方のURLが分かっていてホストが違う場合は同名の別会社を疑う
      const rowHosts = [row.companyUrl, row.formUrl].map(hostOf).filter((host) => host !== null);
      if (!matchedByHost.has(row.rowIndex) && companyHost && rowHosts.length > 0) {
        conflicts.push(match);
        continue;
      }

      if (row.note.includes(NEVER_SEND_MARKER)) {
        alreadyMarked.push(match);
        continue;
      }
      candidates.push(match);
    }
  }

  return { candidates, alreadyMarked, conflicts };
}

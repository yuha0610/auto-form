import type { SheetRowData } from "../types.js";
import { NEVER_SEND_MARKER } from "./targetSelection.js";
import { extractCompanyCoreName, normalizeCellText } from "./textNormalize.js";

export interface ListedCompany {
  /** 証券コード */
  code: string;
  /** 銘柄名。JPXの一覧では全角・法人格なしで入っている(例:「ＨＥＲＯＺ」) */
  name: string;
  /** 市場・商品区分(例:「グロース（内国株式）」) */
  market: string;
}

const CODE_COLUMN = 1;
const NAME_COLUMN = 2;
const MARKET_COLUMN = 3;

/**
 * 株式として上場している市場区分。ETF・ETN、REIT等、出資証券は企業ではないので入れない。
 * ヘッダー行の「市場・商品区分」もここに載らないため、自然に除かれる。
 */
const STOCK_MARKET_PREFIXES = ["プライム", "スタンダード", "グロース", "PRO Market"];

function isStockMarket(market: string): boolean {
  return STOCK_MARKET_PREFIXES.some((prefix) => market.startsWith(prefix));
}

/** JPXの「東証上場銘柄一覧」の表から、株式として上場している銘柄だけを取り出す。 */
export function selectListedStocks(rows: string[][]): ListedCompany[] {
  return rows
    .filter((row) => isStockMarket(row[MARKET_COLUMN] ?? ""))
    .map((row) => ({
      code: row[CODE_COLUMN],
      name: row[NAME_COLUMN],
      market: row[MARKET_COLUMN],
    }));
}

/** 上場を理由に送信対象から外すときに備考へ書き足す印。証券コードで根拠を残す。 */
export function listedMarker(company: ListedCompany): string {
  return `${NEVER_SEND_MARKER}(上場 ${company.code})`;
}

export interface ListedMatch {
  company: ListedCompany;
  row: SheetRowData;
}

export interface ListedMatchResult {
  /** 備考に印を付ける対象 */
  candidates: ListedMatch[];
  /** すでに「送信NG」が付いている行(書き込み不要) */
  alreadyMarked: ListedMatch[];
}

/**
 * 上場銘柄とシートの行を、法人格・全角の表記ゆれを吸収したコア名で突き合わせる。
 * JPXの一覧には企業URLが無いため社名だけの一致になる。同名の別会社を巻き込みうるので、
 * 呼び出し側は書き込み前に必ず一覧を人に確認させること。
 */
export function matchListedCompanies(
  companies: ListedCompany[],
  rows: SheetRowData[],
): ListedMatchResult {
  const rowsByCore = new Map<string, SheetRowData[]>();
  for (const row of rows) {
    const core = extractCompanyCoreName(normalizeCellText(row.companyName));
    if (!core) continue;
    if (!rowsByCore.has(core)) rowsByCore.set(core, []);
    rowsByCore.get(core)!.push(row);
  }

  const candidates: ListedMatch[] = [];
  const alreadyMarked: ListedMatch[] = [];
  for (const company of companies) {
    const core = extractCompanyCoreName(normalizeCellText(company.name));
    if (!core) continue;
    for (const row of rowsByCore.get(core) ?? []) {
      const match = { company, row };
      if (row.note.includes(NEVER_SEND_MARKER)) alreadyMarked.push(match);
      else candidates.push(match);
    }
  }

  return { candidates, alreadyMarked };
}

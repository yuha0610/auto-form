import type { SheetRowData } from "../types.js";
import { NEVER_SEND_MARKER } from "./targetSelection.js";

/**
 * 社名だけで芸能・タレント業と判断してよいキーワード。
 * 「タレント」単体は入れない。タレントマネジメント(人事)・タレントアセスメント(適性検査)など
 * HR系の社名を巻き込むうえ、本物のタレント業は本文側のキーワードで拾えるため。
 */
export const TALENT_NAME_KEYWORDS = ["芸能", "キャスティング", "モデルエージェンシー"];

/** サイト本文から芸能・タレント業と判断するキーワード。社名用より文脈が要るぶん長めにする。 */
export const TALENT_CONTENT_KEYWORDS = [
  "芸能事務所",
  "芸能プロダクション",
  "タレント事務所",
  "タレント派遣",
  "モデル事務所",
  "モデルエージェンシー",
  "インフルエンサー事務所",
  "キャスティング事業",
  "所属タレント",
  "所属モデル",
  "所属アーティスト",
  "読者モデル",
];

function findKeyword(text: string, keywords: string[]): { keyword: string; index: number } | null {
  for (const keyword of keywords) {
    const index = text.indexOf(keyword);
    if (index !== -1) return { keyword, index };
  }
  return null;
}

/** 社名が芸能・タレント業を示していれば、当たったキーワードを返す。 */
export function matchTalentCompanyName(companyName: string): string | null {
  return findKeyword(companyName, TALENT_NAME_KEYWORDS)?.keyword ?? null;
}

export interface TalentMatch {
  keyword: string;
  /** 判定の根拠を人が確かめるための、一致箇所の前後を含む抜粋 */
  snippet: string;
}

const SNIPPET_MARGIN = 30;

/** サイト本文が芸能・タレント業を示していれば、キーワードと前後の抜粋を返す。 */
export function matchTalentPageContent(text: string): TalentMatch | null {
  const hit = findKeyword(text, TALENT_CONTENT_KEYWORDS);
  if (!hit) return null;
  const snippet = text
    .slice(Math.max(0, hit.index - SNIPPET_MARGIN), hit.index + hit.keyword.length + SNIPPET_MARGIN)
    .replace(/\s+/g, " ");
  return { keyword: hit.keyword, snippet };
}

/** タレント業を理由に送信対象から外すときに備考へ書き足す印。 */
export function talentMarker(): string {
  return `${NEVER_SEND_MARKER}(タレント業)`;
}

export interface TalentRowMatch {
  row: SheetRowData;
  match: TalentMatch;
}

export interface TalentCandidateResult {
  /** 備考に印を付ける対象 */
  candidates: TalentRowMatch[];
  /** すでに「送信NG」が付いている行(書き込み不要) */
  alreadyMarked: TalentRowMatch[];
}

/** 判定に当たった行を、印を付ける対象とすでに付いている行に分ける。 */
export function selectTalentCandidates(matches: TalentRowMatch[]): TalentCandidateResult {
  const candidates: TalentRowMatch[] = [];
  const alreadyMarked: TalentRowMatch[] = [];
  for (const entry of matches) {
    if (entry.row.note.includes(NEVER_SEND_MARKER)) alreadyMarked.push(entry);
    else candidates.push(entry);
  }
  return { candidates, alreadyMarked };
}

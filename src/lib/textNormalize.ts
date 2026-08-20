const INVISIBLE_CHARS_REGEX = /[​‌‍﻿]/g;
const WHITESPACE_RUN_REGEX = /[ \t　]+/g;

/**
 * 企業名・URL・備考などのセル値から、前後の空白・全角スペース・
 * ゼロ幅スペースやBOMなどの不可視文字を除去し、内部の連続空白を
 * 半角スペース1つに正規化する。それ以外の文字は変更しない。
 */
export function normalizeCellText(value: string): string {
  return value
    .replace(INVISIBLE_CHARS_REGEX, "")
    .replace(WHITESPACE_RUN_REGEX, " ")
    .trim();
}

const JAPANESE_SUFFIX_PATTERN = "株式会社|有限会社|合同会社|㈱";
const LATIN_SUFFIX_PATTERN =
  "Co\\.,\\s?Ltd\\.?|K\\.K\\.|Corporation|Corp\\.|Inc\\.|Inc|Ltd\\.|Ltd";
/**
 * 英字の法人格トークンは前後を英字で挟まれていないときだけ法人格とみなす。
 * 境界を見ないと「Ginco」の中のIncを落として「Go」にしてしまい、
 * 別会社(GO株式会社)と同じコア名になる。
 */
const CORPORATE_SUFFIX_REGEX = new RegExp(
  `${JAPANESE_SUFFIX_PATTERN}|(?<![A-Za-z])(?:${LATIN_SUFFIX_PATTERN})(?![A-Za-z])`,
  "gi",
);
const NON_CORE_CHARS_REGEX = /[^a-z0-9＆぀-ヿ㐀-鿿]/gi;

/**
 * 企業名から法人格トークン(株式会社/Inc./Ltd.等、前後どちらの位置でも)と
 * 記号・スペースを除去し、小文字化した「コア名」を返す。
 * 表記ゆれ(法人格の有無・位置違い)による重複候補の突き合わせに使う。
 */
export function extractCompanyCoreName(name: string): string {
  const withoutSuffix = name.replace(CORPORATE_SUFFIX_REGEX, "");
  return withoutSuffix.replace(NON_CORE_CHARS_REGEX, "").toLowerCase();
}

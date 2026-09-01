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

// NFKCは㈱を「(株)」、㈲を「(有)」に展開するため、展開後の表記もここで受ける。
const JAPANESE_SUFFIX_PATTERN = "株式会社|有限会社|合同会社|㈱|㈲|\\(株\\)|\\(有\\)";
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
/**
 * コア名に残す文字。カタカナ範囲(U+3040-U+30FF)から中黒(U+30FB)だけを外している。
 * 中黒は「サイト・ファクト」のような区切りにしか使われず、残すと
 * 「サイト-ファクト」と別のコア名になってしまう。長音符(U+30FC)は
 * 「コーヒー」のように語の一部なので残す。
 */
const NON_CORE_CHARS_REGEX = /[^a-z0-9&぀-ヺー-ヿ㐀-鿿]/gi;

/**
 * 企業名から法人格トークン(株式会社/Inc./Ltd.等、前後どちらの位置でも)と
 * 記号・スペースを除去し、小文字化した「コア名」を返す。
 * 表記ゆれ(法人格の有無・位置違い)による重複候補の突き合わせに使う。
 *
 * 全角英数字・半角カタカナはNFKCで半角/全角に寄せてから比較する。
 * これを挟まないと「株式会社１２薬局」の全角数字が丸ごと落ちて
 * 「薬局」になり、「株式会社12薬局」と別企業として重複判定を通り抜ける。
 */
export function extractCompanyCoreName(name: string): string {
  const normalized = name.normalize("NFKC");
  const withoutSuffix = normalized.replace(CORPORATE_SUFFIX_REGEX, "");
  return withoutSuffix.replace(NON_CORE_CHARS_REGEX, "").toLowerCase();
}

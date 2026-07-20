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

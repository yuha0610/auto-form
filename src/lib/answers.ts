const AFFIRMATIVE_ANSWERS = ["y", "yes", "はい"];

/**
 * ターミナルでの入力を、全角/半角や大文字小文字の違いを吸収して正規化する。
 * 日本語入力が有効なままだと全角の「ｙ」が入り、半角の"y"と一致しない。
 */
function normalizeAnswer(input: string): string {
  return input
    .replace(/[\s　]+/g, "")
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .toLowerCase();
}

/** 「はい」と答えたと解釈できる入力かどうか。判断がつかない入力は否定として扱う。 */
export function isAffirmative(input: string): boolean {
  return AFFIRMATIVE_ANSWERS.includes(normalizeAnswer(input));
}

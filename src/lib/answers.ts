/**
 * ターミナルでの入力を、全角/半角や大文字小文字の違いを吸収して正規化する。
 * 日本語入力が有効なままだと全角の「ｙ」「３」が入り、半角前提の比較や
 * Number()が黙って失敗する(実際にこれで送信済み3社の記録が消えた)。
 */
function normalizeAnswer(input: string): string {
  return input
    .replace(/[\s　]+/g, "")
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .toLowerCase();
}

/** 入力を0以上の整数として読む。読めない場合はnullを返す。 */
export function parseAnswerNumber(input: string): number | null {
  const normalized = normalizeAnswer(input);
  if (!/^\d+$/.test(normalized)) return null;
  return Number(normalized);
}

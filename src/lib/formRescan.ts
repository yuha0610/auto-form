import { appendNote } from "./sheetData.js";
import type { ContactLink } from "./formDiscovery.js";
import type { SheetRowData } from "../types.js";

const NOTE_SEPARATOR = " / ";

/**
 * 備考から、指定した印を含む区切りだけを取り除く。
 * 「フォーム無(要確認)」のように印に補足が付いていても消せるよう、
 * 区切りごとに部分一致で判定する。
 */
export function removeNoteMarker(note: string, marker: string): string {
  return note
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part !== "" && !part.includes(marker))
    .join(NOTE_SEPARATOR);
}

export interface RescanWrites {
  kind: ContactLink["kind"];
  /** 保存するフォームURL。既に入っている行では省略する */
  formUrl?: string;
  /** 保存するメールアドレス。既に入っている行では省略する */
  email?: string;
  /** 書き換え後の備考 */
  note: string;
}

/**
 * 再スキャンの結果から、その行に書き込む内容を決める。
 * `marker` には再スキャンの対象になった印(「フォーム無」「読み込み失敗(要確認)」など)を渡す。
 * 見つからなかった場合はその印を残したいので null を返す。
 */
/**
 * 人が手で入れた値として尊重すべきか判定する。
 * 「y」「なし」のような形になっていない値を守ると、開けないフォームURLのまま
 * 送信対象に戻ってしまうので、そういう値は再スキャンの結果で上書きする。
 */
function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function planRescanWrites(
  row: SheetRowData,
  link: ContactLink | null,
  marker: string,
): RescanWrites | null {
  if (!link) return null;

  const cleared = removeNoteMarker(row.note, marker);

  if (link.kind === "google-form") {
    // 自動入力できないので、送信対象から外れる印に差し替える
    return { kind: link.kind, note: appendNote(cleared, "Google Formで不可") };
  }

  if (link.kind === "email") {
    const writes: RescanWrites = { kind: link.kind, note: appendNote(cleared, "メール") };
    // 人が調べて入れたアドレスを再スキャンの結果で潰さない
    if (!looksLikeEmail(row.email)) writes.email = link.address;
    return writes;
  }

  const writes: RescanWrites = { kind: link.kind, note: cleared };
  // 人が手で貼ったフォームURLを再スキャンの結果で潰さない
  if (!looksLikeUrl(row.formUrl)) writes.formUrl = link.url;
  return writes;
}

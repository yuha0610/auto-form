import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const DEFAULT_EXCERPT_LENGTH = 800;

/**
 * 判定に使ったページ本文を、人が読める長さに整えて切り出す。
 * 送信完了の文言はページ上部に出ることが多いので冒頭を採る。
 */
export function buildBodyExcerpt(bodyText: string, maxLength = DEFAULT_EXCERPT_LENGTH): string {
  return bodyText.replace(/[\s　]+/g, " ").trim().slice(0, maxLength);
}

export interface UncertainLogEntry {
  timestamp: string;
  companyName: string;
  url: string;
  bodyExcerpt: string;
}

/** SUCCESS_KEYWORDS拡張の材料にするため、判定できなかったページの本文をJSON Lines形式の1行にする。 */
export function formatUncertainLogLine(entry: UncertainLogEntry): string {
  return `${JSON.stringify(entry)}\n`;
}

export async function appendUncertainLog(path: string, entry: UncertainLogEntry): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, formatUncertainLogLine(entry), "utf-8");
}

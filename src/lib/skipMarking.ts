import { appendNote } from "./sheetData.js";
import { NEVER_SEND_MARKER, SKIP_MARKERS } from "./targetSelection.js";
import { findUrlMatches, splitUrlInput } from "./urlMatch.js";
import type { SheetRowData } from "../types.js";

export interface SkipMarkTarget {
  row: SheetRowData;
  /** 貼り付けられたURLそのもの。どの入力でこの行に辿り着いたかを表示するために持つ */
  url: string;
  /** 書き込む備考の全文(既存の内容に印を追記したもの) */
  newNote: string;
}

export interface SkipMarkAmbiguity {
  url: string;
  rows: SheetRowData[];
}

export interface SkipMarkPlan {
  /** 備考に印を追記する対象 */
  targets: SkipMarkTarget[];
  /** すでに同じ印が付いている行(書き込み不要) */
  alreadyMarked: { row: SheetRowData; url: string }[];
  /** 1つのURLが複数行に一致した。取り違えを避けるため自動では書き込まない */
  ambiguous: SkipMarkAmbiguity[];
  /** どの行にも一致しなかった入力。黙って捨てず呼び出し側に返す */
  unmatched: string[];
}

/**
 * `--reason` の指定を、シートで実際にスキップとして効く印に解決する。
 * 効かない印を書くとスキップしたつもりの企業に送信してしまうため、既知の印だけを通す。
 */
export function resolveSkipReason(reason: string | undefined): string {
  if (reason === undefined) return NEVER_SEND_MARKER;
  const trimmed = reason.trim();
  if (!SKIP_MARKERS.includes(trimmed)) {
    throw new Error(
      `シートで効かない印です: ${trimmed}\n使える印: ${SKIP_MARKERS.join(" / ")}`,
    );
  }
  return trimmed;
}

/**
 * 貼り付けられたURLをシートの行に突き合わせ、備考にスキップ印を追記する計画を立てる。
 * 会社URL・フォームURLのどちらで貼られても同じ行に辿り着けるようにする。
 */
export function planSkipMarks(
  input: string,
  rows: SheetRowData[],
  marker: string,
): SkipMarkPlan {
  const rowByIndex = new Map(rows.map((row) => [row.rowIndex, row]));
  const candidates = rows.map((row) => ({
    key: row.rowIndex,
    urls: [row.companyUrl, row.formUrl].filter((url) => url.trim() !== ""),
  }));

  const targets: SkipMarkTarget[] = [];
  const alreadyMarked: { row: SheetRowData; url: string }[] = [];
  const ambiguous: SkipMarkAmbiguity[] = [];
  const unmatched: string[] = [];
  const seenRows = new Set<number>();

  for (const url of splitUrlInput(input)) {
    const matched = findUrlMatches(url, candidates);

    if (matched.length === 0) {
      unmatched.push(url);
      continue;
    }
    if (matched.length > 1) {
      ambiguous.push({
        url,
        rows: matched.map((candidate) => rowByIndex.get(candidate.key)!),
      });
      continue;
    }

    const row = rowByIndex.get(matched[0].key)!;
    // 同じ行を指すURLが複数貼られても、印は1回だけ追記する
    if (seenRows.has(row.rowIndex)) continue;
    seenRows.add(row.rowIndex);

    if (row.note.includes(marker)) {
      alreadyMarked.push({ row, url });
      continue;
    }
    targets.push({ row, url, newNote: appendNote(row.note, marker) });
  }

  return { targets, alreadyMarked, ambiguous, unmatched };
}

export interface SkipMarkArgs {
  /** 突き合わせに使うURL(区切りは呼び出し先で解釈する) */
  urls: string;
  reason: string | undefined;
  apply: boolean;
}

/** コマンドライン引数を、印の指定・書き込みの有無・対象URLに分ける。 */
export function parseSkipMarkArgs(argv: string[]): SkipMarkArgs {
  const urls: string[] = [];
  let reason: string | undefined;
  let apply = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply") {
      apply = true;
    } else if (arg === "--reason") {
      reason = argv[++i];
      if (reason === undefined) throw new Error("--reason の後に印を指定してください");
    } else if (arg.startsWith("--reason=")) {
      reason = arg.slice("--reason=".length);
    } else {
      urls.push(arg);
    }
  }

  return { urls: urls.join(" "), reason, apply };
}

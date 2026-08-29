import { REPEATED_FAILURE_MARKER } from "./targetSelection.js";
import type { SheetRowData } from "../types.js";

/** 開き直せば直る可能性があるため、1回だけでは打ち切らない失敗の印。 */
const RETRYABLE_FAILURE_MARKERS = [
  "タイムアウト(再試行済・要確認)",
  "接続エラー(再試行済・要確認)",
];

export interface NoteCleanupTarget {
  row: SheetRowData;
  newNote: string;
  /** 何をしたかの説明(確認用の一覧表示に使う) */
  summary: string;
}

/**
 * appendNoteが使う「 / 」だけを区切りとして扱う。
 * 単なる"/"で分けると、手で書いた備考の中の日付(2026/08/27)まで分断してしまう。
 */
function splitNote(note: string): string[] {
  return note.split(" / ").map((part) => part.trim()).filter(Boolean);
}

/**
 * 失敗のたびに同じ印が積み上がってしまった備考を整理する。
 * 同じ印は1つにまとめ、一時的な失敗を繰り返していた行は打ち切りの印を付けて対象から外す。
 */
export function planNoteCleanup(rows: SheetRowData[]): NoteCleanupTarget[] {
  const targets: NoteCleanupTarget[] = [];

  for (const row of rows) {
    const parts = splitNote(row.note);
    const unique = [...new Set(parts)];
    const removed = parts.length - unique.length;

    const repeated = RETRYABLE_FAILURE_MARKERS.filter(
      (marker) => parts.filter((part) => part === marker).length >= 2,
    );
    const capped = repeated.length > 0 && !unique.includes(REPEATED_FAILURE_MARKER);
    if (capped) unique.push(REPEATED_FAILURE_MARKER);

    const newNote = unique.join(" / ");
    if (newNote === row.note) continue;

    const notes: string[] = [];
    if (removed > 0) notes.push(`重複した印を${removed}件まとめる`);
    if (capped) notes.push(`「${REPEATED_FAILURE_MARKER}」を付けて打ち切る`);
    targets.push({ row, newNote, summary: notes.join(" / ") || "備考の書式を整える" });
  }

  return targets;
}

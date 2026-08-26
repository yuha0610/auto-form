import { appendNote } from "./sheetData.js";
import { removeNoteMarker } from "./formRescan.js";
import { formatSheetDate, SKIP_MARKERS } from "./targetSelection.js";
import { findUrlMatches } from "./urlMatch.js";
import { COLUMNS, type SheetRowData } from "../types.js";
import type { CellWrite } from "./updates.js";

const FORM_MISSING_MARKER = "フォーム無";
const EMAIL_MARKER = "メール";
const FAILED_MARKER = "送信失敗";

const OUTCOMES = ["sent", "email", "failed", "skip", "form-url"] as const;
export type RecordOutcome = (typeof OUTCOMES)[number];

export interface RecordEntry {
  /** 突き合わせに使うURL。会社URL・フォームURLのどちらでもよい */
  url: string;
  outcome: RecordOutcome;
  /** 保存するフォームURL(sent / form-url) */
  formUrl?: string;
  /** 保存するメールアドレス(email) */
  email?: string;
  /** 付けるスキップ印(skip) */
  reason?: string;
}

export interface RecordTarget {
  row: SheetRowData;
  entry: RecordEntry;
  writes: CellWrite[];
  /** 画面に出す1行の説明 */
  summary: string;
}

export interface RecordError {
  url: string;
  message: string;
}

export interface RecordPlan {
  targets: RecordTarget[];
  /** すでに反映済みで書き込み不要だったもの */
  alreadyDone: { row: SheetRowData; entry: RecordEntry }[];
  /** 1つのURLが複数行に一致した。取り違えを避けるため書き込まない */
  ambiguous: { url: string; rows: SheetRowData[] }[];
  /** どの行にも一致しなかったURL */
  unmatched: string[];
  errors: RecordError[];
}

/** JSONファイルの中身を読み、扱える形になっているか確かめる。 */
export function parseRecordEntries(content: string): RecordEntry[] {
  const parsed: unknown = JSON.parse(content);
  if (!Array.isArray(parsed)) throw new Error("記録ファイルは配列で書いてください");

  return parsed.map((raw, i) => {
    const item = raw as Partial<RecordEntry>;
    const where = `${i + 1}件目`;
    if (typeof item.url !== "string" || item.url.trim() === "") {
      throw new Error(`${where}: url が必要です`);
    }
    if (typeof item.outcome !== "string" || !OUTCOMES.includes(item.outcome as RecordOutcome)) {
      throw new Error(`${where}: outcome は ${OUTCOMES.join(" / ")} のいずれかにしてください`);
    }
    const entry: RecordEntry = { url: item.url.trim(), outcome: item.outcome as RecordOutcome };
    if (item.formUrl) entry.formUrl = item.formUrl;
    if (item.email) entry.email = item.email;
    if (item.reason) entry.reason = item.reason;
    return entry;
  });
}

const ATTEMPT_COLUMNS = [COLUMNS.firstSent, COLUMNS.secondSent, COLUMNS.thirdSent];

/** まだ日付が入っていない送信回の列名を返す。3回とも埋まっていればnull。 */
function nextAttemptColumn(row: SheetRowData): string | null {
  const sent = [row.firstSentAt, row.secondSentAt, row.thirdSentAt];
  const index = sent.findIndex((value) => !value);
  return index === -1 ? null : ATTEMPT_COLUMNS[index];
}

/** 1件分の書き込み内容を決める。書けない場合はエラー文言を返す。 */
function buildWrites(
  row: SheetRowData,
  entry: RecordEntry,
  today: Date,
): { writes: CellWrite[]; summary: string } | { error: string } | { alreadyDone: true } {
  const writes: CellWrite[] = [];
  const put = (columnName: string, value: string) =>
    writes.push({ rowIndex: row.rowIndex, columnName, value });

  // 実態と合わなくなるので、どの結果でも「フォーム無」は外す
  let note = removeNoteMarker(row.note, FORM_MISSING_MARKER);
  let summary: string;

  switch (entry.outcome) {
    case "sent": {
      const column = nextAttemptColumn(row);
      if (!column) return { error: "すでに3回とも送信済みのため記録できません" };
      put(column, formatSheetDate(today));
      if (entry.formUrl) put(COLUMNS.formUrl, entry.formUrl);
      summary = `${column}に${formatSheetDate(today)}を記録`;
      break;
    }
    case "email": {
      if (!entry.email) return { error: "email が必要です" };
      // 人が調べて入れたアドレスを上書きしない
      if (row.email.trim() === "") put(COLUMNS.email, entry.email);
      if (!note.includes(EMAIL_MARKER)) note = appendNote(note, EMAIL_MARKER);
      summary = row.email.trim() === "" ? `メール列に${entry.email}を保存` : "メール列は既存の値を残す";
      break;
    }
    case "failed": {
      if (entry.formUrl) put(COLUMNS.formUrl, entry.formUrl);
      if (!note.includes(FAILED_MARKER)) note = appendNote(note, FAILED_MARKER);
      summary = "備考に「送信失敗」を追記";
      break;
    }
    case "skip": {
      const reason = (entry.reason ?? "").trim();
      if (!SKIP_MARKERS.includes(reason)) {
        return {
          error: `シートで効かない印です: ${reason || "(未指定)"}\n    使える印: ${SKIP_MARKERS.join(" / ")}`,
        };
      }
      if (row.note.includes(reason)) return { alreadyDone: true };
      note = appendNote(note, reason);
      summary = `備考に「${reason}」を追記`;
      break;
    }
    case "form-url": {
      if (!entry.formUrl) return { error: "formUrl が必要です" };
      put(COLUMNS.formUrl, entry.formUrl);
      summary = `フォームURLを${entry.formUrl}に更新`;
      break;
    }
  }

  if (note !== row.note) put(COLUMNS.note, note);
  if (writes.length === 0) return { alreadyDone: true };
  return { writes, summary };
}

/**
 * 記録したい結果をシートの行に突き合わせ、書き込む内容を決める。
 * 突き合わせは会社URL・フォームURLの両方を候補にする。
 */
export function planOutcomeRecords(
  entries: RecordEntry[],
  rows: SheetRowData[],
  today: Date,
): RecordPlan {
  const rowByIndex = new Map(rows.map((row) => [row.rowIndex, row]));
  const candidates = rows.map((row) => ({
    key: row.rowIndex,
    urls: [row.companyUrl, row.formUrl].filter((url) => url.trim() !== ""),
  }));

  const plan: RecordPlan = {
    targets: [],
    alreadyDone: [],
    ambiguous: [],
    unmatched: [],
    errors: [],
  };
  const seenRows = new Set<number>();

  for (const entry of entries) {
    const matched = findUrlMatches(entry.url, candidates);
    if (matched.length === 0) {
      plan.unmatched.push(entry.url);
      continue;
    }
    if (matched.length > 1) {
      plan.ambiguous.push({
        url: entry.url,
        rows: matched.map((candidate) => rowByIndex.get(candidate.key)!),
      });
      continue;
    }

    const row = rowByIndex.get(matched[0].key)!;
    // 同じ行に別々の結果を書こうとしている。どちらが正しいか判断できないので書き込まない
    if (seenRows.has(row.rowIndex)) {
      plan.errors.push({
        url: entry.url,
        message: `row${row.rowIndex}(${row.companyName})への指定が重複しています`,
      });
      continue;
    }
    seenRows.add(row.rowIndex);

    const built = buildWrites(row, entry, today);
    if ("error" in built) {
      plan.errors.push({ url: entry.url, message: built.error });
      continue;
    }
    if ("alreadyDone" in built) {
      plan.alreadyDone.push({ row, entry });
      continue;
    }
    plan.targets.push({ row, entry, writes: built.writes, summary: built.summary });
  }

  return plan;
}

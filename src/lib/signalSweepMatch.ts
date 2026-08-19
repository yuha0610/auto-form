import type { SheetRowData } from "../types.js";
import { extractCompanyCoreName } from "./textNormalize.js";
import type { ExistingSignalResult, NewCandidateResult } from "./signalDetection.js";

/** Workflowでの一括収集(sweep)が返す1件の資金調達イベント。 */
export interface SweepEvent {
  companyName: string;
  companyUrl?: string;
  amount?: string;
  round?: string;
  /** 発表日(YYYY-MM-DD) */
  announcedDate: string;
  sourceUrl: string;
  confidence: "high" | "low";
}

const SIGNAL_TYPE_FUNDING = "資金調達";

/**
 * sweepの日付(YYYY-MM-DD)をシートの日付形式(YYYY/MM/DD)に変換する。
 * シート側の`parseSheetDate`は`/`区切りしか解釈しないため、この変換を挟まないと
 * 新しいシグナルが「変更なし」に分類されて1件も書き込まれない。
 */
export function toSheetDate(isoDate: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  return `${year}/${month}/${day}`;
}

export interface SkippedEvent {
  companyName: string;
  reason: string;
}

export interface SweepMatchResult {
  existingSignals: ExistingSignalResult[];
  newCandidates: NewCandidateResult[];
  skipped: SkippedEvent[];
}

function buildReason(event: SweepEvent): string {
  const parts = [event.round, event.amount].filter((part) => part && part.trim() !== "");
  const detail = parts.length > 0 ? parts.join(" / ") : "詳細非開示";
  return `${event.announcedDate}に資金調達を発表(${detail})`;
}

/**
 * 収集した資金調達イベントを、企業名のコア名でシートの行と突き合わせる。
 * 一致した行は既存シグナルの更新候補、一致しなかったものは新規発掘候補として返す。
 * 一致した場合の`companyName`はシート側の表記を採用する(`buildSignalWrites`が
 * 書き込み直前にシートの企業名と照合するため、プレスリリース側の表記だと弾かれる)。
 */
export function matchSweepEvents(events: SweepEvent[], rows: SheetRowData[]): SweepMatchResult {
  const rowByCoreName = new Map<string, SheetRowData>();
  for (const row of rows) {
    const coreName = extractCompanyCoreName(row.companyName);
    if (coreName !== "" && !rowByCoreName.has(coreName)) {
      rowByCoreName.set(coreName, row);
    }
  }

  const existingSignals: ExistingSignalResult[] = [];
  const newCandidates: NewCandidateResult[] = [];
  const skipped: SkippedEvent[] = [];

  for (const event of events) {
    const signalDate = toSheetDate(event.announcedDate);
    if (!signalDate) {
      skipped.push({
        companyName: event.companyName,
        reason: `発表日を解釈できませんでした: "${event.announcedDate}"`,
      });
      continue;
    }

    const coreName = extractCompanyCoreName(event.companyName);
    const matchedRow = coreName !== "" ? rowByCoreName.get(coreName) : undefined;

    if (matchedRow) {
      existingSignals.push({
        rowIndex: matchedRow.rowIndex,
        companyName: matchedRow.companyName,
        signalType: SIGNAL_TYPE_FUNDING,
        signalDate,
        sourceUrl: event.sourceUrl,
        confidence: event.confidence,
        reason: buildReason(event),
      });
      continue;
    }

    newCandidates.push({
      companyName: event.companyName,
      companyUrl: event.companyUrl ?? "",
      signalType: SIGNAL_TYPE_FUNDING,
      signalDate,
      sourceUrl: event.sourceUrl,
      confidence: event.confidence,
      reason: buildReason(event),
    });
  }

  return { existingSignals, newCandidates, skipped };
}

import { COLUMNS, type SheetRowData } from "../types.js";

export interface RawSheetData {
  headerRow: string[];
  dataRows: string[][];
}

export function columnIndexToLetter(index: number): string {
  let letter = "";
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

export function appendNote(existing: string, addition: string): string {
  const trimmed = existing.trim();
  return trimmed ? `${trimmed} / ${addition}` : addition;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * 値が入っている最後の行の行番号(1始まり)を返す。1行も値がなければ0。
 * Sheets APIの`values.append`は範囲の先頭セルが空だと「表が空」と誤判定して
 * 先頭に行を挿入してしまうため、末尾追記では自前でこの行番号を求める。
 */
export function findLastNonEmptyRow(values: string[][]): number {
  for (let i = values.length - 1; i >= 0; i--) {
    const row = values[i] ?? [];
    if (row.some((cell) => (cell ?? "").trim() !== "")) return i + 1;
  }
  return 0;
}

export function findColumnIndex(headerRow: string[], columnName: string): number {
  const target = normalizeWhitespace(columnName);
  const index = headerRow.findIndex((header) => normalizeWhitespace(header) === target);
  if (index === -1) {
    throw new Error(`列が見つかりません: ${columnName}`);
  }
  return index;
}

export function parseSheetRows(raw: RawSheetData): SheetRowData[] {
  const col = {
    companyName: findColumnIndex(raw.headerRow, COLUMNS.companyName),
    companyUrl: findColumnIndex(raw.headerRow, COLUMNS.companyUrl),
    formUrl: findColumnIndex(raw.headerRow, COLUMNS.formUrl),
    note: findColumnIndex(raw.headerRow, COLUMNS.note),
    dealStatus: findColumnIndex(raw.headerRow, COLUMNS.dealStatus),
    firstSent: findColumnIndex(raw.headerRow, COLUMNS.firstSent),
    secondSent: findColumnIndex(raw.headerRow, COLUMNS.secondSent),
    thirdSent: findColumnIndex(raw.headerRow, COLUMNS.thirdSent),
    email: findColumnIndex(raw.headerRow, COLUMNS.email),
    fundingAmount: findColumnIndex(raw.headerRow, COLUMNS.fundingAmount),
    fundingRound: findColumnIndex(raw.headerRow, COLUMNS.fundingRound),
    fundingMonth: findColumnIndex(raw.headerRow, COLUMNS.fundingMonth),
    prTimesUrl: findColumnIndex(raw.headerRow, COLUMNS.prTimesUrl),
    signalType: findColumnIndex(raw.headerRow, COLUMNS.signalType),
    signalDate: findColumnIndex(raw.headerRow, COLUMNS.signalDate),
    signalSourceUrl: findColumnIndex(raw.headerRow, COLUMNS.signalSourceUrl),
  };

  return raw.dataRows.map((cells, i) => ({
    rowIndex: i + 2,
    companyName: cells[col.companyName] ?? "",
    companyUrl: cells[col.companyUrl] ?? "",
    formUrl: cells[col.formUrl] ?? "",
    note: cells[col.note] ?? "",
    dealStatus: cells[col.dealStatus] ?? "",
    firstSentAt: cells[col.firstSent] || null,
    secondSentAt: cells[col.secondSent] || null,
    thirdSentAt: cells[col.thirdSent] || null,
    email: cells[col.email] ?? "",
    fundingAmount: cells[col.fundingAmount] ?? "",
    fundingRound: cells[col.fundingRound] ?? "",
    fundingMonth: cells[col.fundingMonth] ?? "",
    prTimesUrl: cells[col.prTimesUrl] ?? "",
    signalType: cells[col.signalType] ?? "",
    signalDate: cells[col.signalDate] || null,
    signalSourceUrl: cells[col.signalSourceUrl] ?? "",
  }));
}

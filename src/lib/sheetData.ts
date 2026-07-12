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
  }));
}

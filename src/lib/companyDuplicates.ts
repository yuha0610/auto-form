import type { SheetRowData } from "../types.js";
import { attemptProgress } from "./targetSelection.js";
import { extractCompanyCoreName } from "./textNormalize.js";

export interface DuplicateGroup {
  coreName: string;
  rows: SheetRowData[];
}

/** 法人格の有無・位置違いなどの表記ゆれを吸収したコア名で行をグループ化する。単独行は含めない。 */
export function groupByCoreName(rows: SheetRowData[]): DuplicateGroup[] {
  const rowsByCoreName = new Map<string, SheetRowData[]>();
  for (const row of rows) {
    const coreName = extractCompanyCoreName(row.companyName);
    if (!coreName) continue;
    if (!rowsByCoreName.has(coreName)) rowsByCoreName.set(coreName, []);
    rowsByCoreName.get(coreName)!.push(row);
  }

  return [...rowsByCoreName.entries()]
    .filter(([, groupRows]) => groupRows.length > 1)
    .map(([coreName, groupRows]) => ({ coreName, rows: groupRows }));
}

function dealStatusRank(row: SheetRowData): number {
  return row.dealStatus.trim() !== "" ? 1 : 0;
}

/**
 * 重複行の中から残す1行を選ぶ。
 * 優先順位: 商談確定日がある行 > 送信回数(attemptProgress)が多い行 > 元の行順で先頭。
 */
export function choosePrimaryRow(
  rows: SheetRowData[],
): { primary: SheetRowData; discarded: SheetRowData[] } {
  let primary = rows[0];
  for (const row of rows.slice(1)) {
    const rowRank: [number, number] = [dealStatusRank(row), attemptProgress(row)];
    const primaryRank: [number, number] = [dealStatusRank(primary), attemptProgress(primary)];
    const isHigherPriority =
      rowRank[0] > primaryRank[0] || (rowRank[0] === primaryRank[0] && rowRank[1] > primaryRank[1]);
    if (isHigherPriority) primary = row;
  }
  return { primary, discarded: rows.filter((row) => row !== primary) };
}

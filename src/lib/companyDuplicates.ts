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

export interface CleanupDecision {
  coreName: string;
  merge: boolean;
  notes?: string;
}

export interface ResolvedGroup {
  coreName: string;
  primary: SheetRowData;
  discarded: SheetRowData[];
}

export interface UnresolvedGroup {
  coreName: string;
  rows: SheetRowData[];
  reason: string;
}

function namesEqual(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** 企業名が完全一致しない(=Fableでの目視確認が必要な)組み合わせを全て返す。 */
export function pairsNeedingReview(rows: SheetRowData[]): [SheetRowData, SheetRowData][] {
  const pairs: [SheetRowData, SheetRowData][] = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (!namesEqual(rows[i].companyName, rows[j].companyName)) {
        pairs.push([rows[i], rows[j]]);
      }
    }
  }
  return pairs;
}

/**
 * 重複グループを「自動統合してよいもの」と「要目視確認のもの」に分ける。
 * - 企業名が完全一致するグループはFable判定なしで自動統合する
 * - 完全一致しないペアが1組でもあるグループは、`decisions`に
 *   `merge: true`の決定が無い限り統合せず要目視確認とする
 */
export function resolveDuplicateGroups(
  groups: DuplicateGroup[],
  decisions: CleanupDecision[],
): { resolved: ResolvedGroup[]; unresolved: UnresolvedGroup[] } {
  const decisionByCoreName = new Map(decisions.map((d) => [d.coreName, d]));
  const resolved: ResolvedGroup[] = [];
  const unresolved: UnresolvedGroup[] = [];

  for (const group of groups) {
    const reviewPairs = pairsNeedingReview(group.rows);
    if (reviewPairs.length === 0) {
      const { primary, discarded } = choosePrimaryRow(group.rows);
      resolved.push({ coreName: group.coreName, primary, discarded });
      continue;
    }

    const decision = decisionByCoreName.get(group.coreName);
    if (decision?.merge) {
      const { primary, discarded } = choosePrimaryRow(group.rows);
      resolved.push({ coreName: group.coreName, primary, discarded });
    } else {
      const reason = decision
        ? `Fableが同一企業ではないと判定しました${decision.notes ? `(${decision.notes})` : ""}`
        : "Fable未判定です。data/cleanup-decisions.json に判定結果を追加してください";
      unresolved.push({ coreName: group.coreName, rows: group.rows, reason });
    }
  }

  return { resolved, unresolved };
}

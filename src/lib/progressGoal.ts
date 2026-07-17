import type { SheetRowData } from "../types.js";
import { parseSheetDate } from "./targetSelection.js";

export interface Goal {
  targetCount: number;
  deadline: Date;
}

export function parseGoal(targetCountRaw: string, deadlineRaw: string): Goal | null {
  const targetCount = Number(targetCountRaw);
  if (!Number.isFinite(targetCount) || targetCount <= 0) return null;

  const deadline = parseSheetDate(deadlineRaw || null);
  if (!deadline) return null;

  return { targetCount, deadline };
}

export function countFirstSent(rows: SheetRowData[]): number {
  return rows.filter((row) => (row.firstSentAt ?? "").trim() !== "").length;
}

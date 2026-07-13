import { parseSheetDate } from "./targetSelection.js";
import type { SheetRowData } from "../types.js";

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function countSentToday(rows: SheetRowData[], today: Date): number {
  return rows.filter((row) =>
    [row.firstSentAt, row.secondSentAt, row.thirdSentAt].some((value) => {
      const date = parseSheetDate(value);
      return date !== null && isSameDay(date, today);
    }),
  ).length;
}

export function buildSlackPayload(count: number): { text: string } {
  return { text: `今日の送信: ${count}件` };
}

export async function notifySlackDailyCount(count: number): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn("SLACK_WEBHOOK_URL が設定されていないため、Slack通知をスキップしました");
    return;
  }
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildSlackPayload(count)),
    });
    if (!response.ok) {
      console.warn(`Slack通知に失敗しました: HTTP ${response.status}`);
    }
  } catch (error) {
    console.warn(`Slack通知に失敗しました: ${String(error)}`);
  }
}

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function buildNotifyCommand(openedCount: number): string {
  const message = `${openedCount}件のタブを開きました。確認・送信をお願いします。`;
  return `display notification "${message}" with title "auto-form" sound name "Glass"`;
}

export async function notifyBatchReady(openedCount: number): Promise<void> {
  if (process.platform !== "darwin") return;
  try {
    await execFileAsync("osascript", ["-e", buildNotifyCommand(openedCount)]);
  } catch (error) {
    console.warn(`通知の送信に失敗しました: ${String(error)}`);
  }
}

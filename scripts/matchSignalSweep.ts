import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { createSheetsClient, fetchSheetData, getFirstSheetName } from "../src/lib/sheetsClient.js";
import { parseSheetRows } from "../src/lib/sheetData.js";
import { matchSweepEvents, type SweepEvent } from "../src/lib/signalSweepMatch.js";

const SWEEP_PATH = "data/signal-sweep-raw.json";
const OUTPUT_PATH = "data/signal-research-results.json";

interface SweepFile {
  range?: { from: string; to: string };
  events: SweepEvent[];
}

async function main(): Promise<void> {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) {
    throw new Error("環境変数 GOOGLE_SHEET_ID が設定されていません");
  }

  const sweep = JSON.parse(await readFile(SWEEP_PATH, "utf-8")) as SweepFile;
  const client = await createSheetsClient();
  const sheetName = await getFirstSheetName(client, spreadsheetId);
  const raw = await fetchSheetData(client, spreadsheetId, sheetName);
  const rows = parseSheetRows(raw);

  const { existingSignals, newCandidates, skipped } = matchSweepEvents(sweep.events, rows);

  console.log(`収集イベント: ${sweep.events.length}件`);
  if (sweep.range) console.log(`対象期間: ${sweep.range.from} 〜 ${sweep.range.to}`);
  console.log(`シート内の既存企業と一致: ${existingSignals.length}件`);
  console.log(`シートに無い新規候補: ${newCandidates.length}件`);
  console.log(`スキップ(日付解釈不能): ${skipped.length}件`);

  if (existingSignals.length > 0) {
    console.log("\n=== 既存企業のシグナル更新候補 ===");
    for (const signal of existingSignals) {
      console.log(`  [行${signal.rowIndex}] ${signal.companyName} | ${signal.signalDate} | ${signal.reason} (${signal.confidence})`);
    }
  }

  if (newCandidates.length > 0) {
    console.log("\n=== 新規発掘候補(リスト未掲載) ===");
    for (const candidate of newCandidates) {
      console.log(`  ${candidate.companyName} | ${candidate.signalDate} | ${candidate.reason} (${candidate.confidence})`);
      console.log(`    URL: ${candidate.companyUrl || "(不明)"}`);
    }
  }

  if (skipped.length > 0) {
    console.log("\n=== スキップ ===");
    for (const item of skipped) console.log(`  ${item.companyName}: ${item.reason}`);
  }

  await writeFile(OUTPUT_PATH, JSON.stringify({ existingSignals, newCandidates }, null, 2), "utf-8");
  console.log(`\n${OUTPUT_PATH} に書き出しました。`);
  console.log("次のステップ: npm run apply:signals (dry-run) で更新内容を確認してください。");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

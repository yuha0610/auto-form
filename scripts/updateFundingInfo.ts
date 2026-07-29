import "dotenv/config";
import { readFile } from "node:fs/promises";
import { createSheetsClient, fetchSheetData, getFirstSheetName, writeCells } from "../src/lib/sheetsClient.js";
import { parseSheetRows } from "../src/lib/sheetData.js";
import { classifyFundingResults, buildFundingWrites, type FundingResearchResult } from "../src/lib/fundingUpdate.js";
import { COLUMNS } from "../src/types.js";

const RESULTS_PATH = "data/funding-research-results.json";

const FUNDING_COLUMN_NAMES = {
  fundingAmount: COLUMNS.fundingAmount,
  fundingRound: COLUMNS.fundingRound,
  fundingMonth: COLUMNS.fundingMonth,
  prTimesUrl: COLUMNS.prTimesUrl,
};

async function loadResults(): Promise<FundingResearchResult[]> {
  try {
    const content = await readFile(RESULTS_PATH, "utf-8");
    return JSON.parse(content) as FundingResearchResult[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      throw new Error(
        `${RESULTS_PATH} が見つかりません。先にWorkflowで調査を実行し、結果をこのパスに保存してください`,
      );
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) {
    throw new Error("環境変数 GOOGLE_SHEET_ID が設定されていません");
  }

  const results = await loadResults();
  const client = await createSheetsClient();
  const sheetName = await getFirstSheetName(client, spreadsheetId);
  const raw = await fetchSheetData(client, spreadsheetId, sheetName);
  const rows = parseSheetRows(raw);

  const { updateCandidates, needsReview, unchangedCount } = classifyFundingResults(results, rows);

  console.log(`=== 更新候補: ${updateCandidates.length}件 ===`);
  for (const candidate of updateCandidates) {
    console.log(`  [行${candidate.rowIndex}] ${candidate.companyName}`);
    console.log(`    資金調達額: "${candidate.before.fundingAmount}" -> "${candidate.after.fundingAmount}"`);
    console.log(`    企業ラウンド: "${candidate.before.fundingRound}" -> "${candidate.after.fundingRound}"`);
    console.log(`    資金調達月: "${candidate.before.fundingMonth}" -> "${candidate.after.fundingMonth}"`);
    console.log(`    PRTimes URL: "${candidate.before.prTimesUrl}" -> "${candidate.after.prTimesUrl}"`);
  }

  console.log(`\n=== 要目視確認: ${needsReview.length}件 ===`);
  for (const item of needsReview) {
    console.log(`  [行${item.rowIndex}] ${item.companyName}: ${item.reason}`);
  }

  console.log(`\n=== 変更なし/情報見つからず: ${unchangedCount}件 ===`);

  if (!apply) {
    console.log(
      "\n(ドライランのため、実際の書き込みは行っていません。内容を確認して --apply を付けて再実行してください)",
    );
    return;
  }

  const latestRaw = await fetchSheetData(client, spreadsheetId, sheetName);
  const latestRows = parseSheetRows(latestRaw);
  const { writes, staleSkips } = buildFundingWrites(updateCandidates, latestRows, FUNDING_COLUMN_NAMES);

  if (staleSkips.length > 0) {
    console.log(`\n=== 書き込みスキップ(シート上の値が調査時点と変わっています): ${staleSkips.length}件 ===`);
    for (const skip of staleSkips) {
      console.log(`  [行${skip.rowIndex}] ${skip.companyName}`);
    }
  }

  if (writes.length > 0) {
    try {
      await writeCells(client, spreadsheetId, sheetName, writes, latestRaw.headerRow);
      console.log(`\n${writes.length / 4}社分の資金調達情報を書き込みました。`);
    } catch (error) {
      console.error(`\n書き込みに失敗しました: ${String(error)}`);
      throw error;
    }
  } else {
    console.log("\n書き込み対象がありませんでした。");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

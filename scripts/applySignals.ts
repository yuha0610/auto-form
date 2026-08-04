import "dotenv/config";
import { readFile } from "node:fs/promises";
import {
  createSheetsClient,
  fetchSheetData,
  getFirstSheetName,
  writeCells,
  appendRows,
} from "../src/lib/sheetsClient.js";
import { parseSheetRows } from "../src/lib/sheetData.js";
import {
  classifyExistingSignals,
  buildSignalWrites,
  classifyNewCandidates,
  buildNewRowValues,
  SIGNAL_COLUMN_NAMES,
  type ExistingSignalResult,
  type NewCandidateResult,
  type NewCompanyRow,
  type NewRowReviewItem,
} from "../src/lib/signalDetection.js";
import { matchPageContent as matchCompetitorPageContent, resolveOverviewUrl } from "../src/lib/competitorScreening.js";
import { matchPageContent as matchNonStartupPageContent } from "../src/lib/nonStartupScreening.js";

const RESULTS_PATH = "data/signal-research-results.json";
const TIMEOUT_MS = 10_000;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

interface SignalResearchResult {
  existingSignals: ExistingSignalResult[];
  newCandidates: NewCandidateResult[];
}

async function loadResults(): Promise<SignalResearchResult> {
  try {
    const content = await readFile(RESULTS_PATH, "utf-8");
    return JSON.parse(content) as SignalResearchResult;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      throw new Error(
        `${RESULTS_PATH} が見つかりません。先にWorkflowで調査を実行し、結果をこのパスに保存してください`,
      );
    }
    throw error;
  }
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "follow",
  });
  return await res.text();
}

async function passesContentScreening(row: NewCompanyRow): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!row.companyUrl) return { ok: true };

  try {
    const topHtml = await fetchText(row.companyUrl);
    let combined = topHtml;

    const overviewUrl = resolveOverviewUrl(row.companyUrl, topHtml);
    if (overviewUrl) {
      try {
        combined += "\n" + (await fetchText(overviewUrl));
      } catch {
        // 概要ページの取得に失敗した場合はトップページのみで判定する
      }
    }

    const competitorMatch = matchCompetitorPageContent(combined);
    if (competitorMatch) {
      return { ok: false, reason: `ページ内容に「${competitorMatch.keyword}」(競合)` };
    }

    const nonStartupMatch = matchNonStartupPageContent(combined);
    if (nonStartupMatch) {
      return { ok: false, reason: `ページ内容に「${nonStartupMatch.keyword}」(非スタートアップ)` };
    }

    return { ok: true };
  } catch {
    return { ok: true };
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

  const { updateCandidates, needsReview: existingNeedsReview, unchangedCount } =
    classifyExistingSignals(results.existingSignals, rows);

  console.log(`=== 既存企業・更新候補: ${updateCandidates.length}件 ===`);
  for (const candidate of updateCandidates) {
    console.log(`  [行${candidate.rowIndex}] ${candidate.companyName}`);
    console.log(`    検知シグナル種別: "${candidate.before.signalType}" -> "${candidate.after.signalType}"`);
    console.log(`    検知日: "${candidate.before.signalDate}" -> "${candidate.after.signalDate}"`);
    console.log(`    検知元URL: "${candidate.before.signalSourceUrl}" -> "${candidate.after.signalSourceUrl}"`);
  }

  if (existingNeedsReview.length > 0) {
    console.log(`\n=== 既存企業・要確認: ${existingNeedsReview.length}件 ===`);
    for (const item of existingNeedsReview) {
      console.log(`  [行${item.rowIndex}] ${item.companyName}: ${item.reason}`);
    }
  }

  const { provisionalRows, needsReview: newCandidateNeedsReview } =
    classifyNewCandidates(results.newCandidates, rows);

  const newRows: NewCompanyRow[] = [];
  const contentReview: NewRowReviewItem[] = [];
  for (const row of provisionalRows) {
    const screening = await passesContentScreening(row);
    if (screening.ok) {
      newRows.push(row);
    } else {
      contentReview.push({ companyName: row.companyName, reason: screening.reason });
    }
  }

  console.log(`\n=== 新規追加候補: ${newRows.length}件 ===`);
  for (const row of newRows) {
    console.log(`  ${row.companyName} (${row.companyUrl})`);
    console.log(`    検知シグナル種別: ${row.signalType} / 検知日: ${row.signalDate} / URL: ${row.signalSourceUrl}`);
  }

  const newCompanyReview = [...newCandidateNeedsReview, ...contentReview];
  if (newCompanyReview.length > 0) {
    console.log(`\n=== 新規企業・要確認: ${newCompanyReview.length}件 ===`);
    for (const item of newCompanyReview) {
      console.log(`  ${item.companyName}: ${item.reason}`);
    }
  }

  console.log(`\n=== 変更なし: ${unchangedCount}件 ===`);

  if (!apply) {
    console.log("\n--apply を付けずに実行したため、シートへの書き込みは行っていません。");
    return;
  }

  const currentRaw = await fetchSheetData(client, spreadsheetId, sheetName);
  const currentRows = parseSheetRows(currentRaw);

  const { writes, staleSkips } = buildSignalWrites(updateCandidates, currentRows, SIGNAL_COLUMN_NAMES);
  if (staleSkips.length > 0) {
    console.log(`\n書き込み直前の再確認でスキップした行: ${staleSkips.length}件`);
    for (const skip of staleSkips) {
      console.log(`  [行${skip.rowIndex}] ${skip.companyName}: ${skip.reason}`);
    }
  }
  await writeCells(client, spreadsheetId, sheetName, writes, currentRaw.headerRow);
  console.log(`\n既存企業へのシグナル反映: ${updateCandidates.length - staleSkips.length}件`);

  if (newRows.length > 0) {
    const rowValues = newRows.map((row) => buildNewRowValues(row, currentRaw.headerRow));
    await appendRows(client, spreadsheetId, sheetName, rowValues);
    console.log(`新規企業の追加: ${newRows.length}件`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

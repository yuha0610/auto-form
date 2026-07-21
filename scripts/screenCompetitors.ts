import "dotenv/config";
import {
  createSheetsClient,
  fetchSheetData,
  getFirstSheetName,
  getSheetId,
  deleteRows,
} from "../src/lib/sheetsClient.js";
import { parseSheetRows } from "../src/lib/sheetData.js";
import {
  matchCompanyName,
  matchPageContent,
  resolveOverviewUrl,
} from "../src/lib/competitorScreening.js";
import type { SheetRowData } from "../src/types.js";

const CONCURRENCY = 8;
const TIMEOUT_MS = 10_000;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

interface Candidate {
  rowIndex: number;
  companyName: string;
  companyUrl: string;
  reason: string;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "follow",
  });
  return await res.text();
}

async function screenRow(row: SheetRowData): Promise<Candidate | null> {
  const nameMatch = matchCompanyName(row.companyName);
  if (nameMatch) {
    return {
      rowIndex: row.rowIndex,
      companyName: row.companyName,
      companyUrl: row.companyUrl,
      reason: `企業名に「${nameMatch}」`,
    };
  }

  if (!row.companyUrl || row.companyUrl === "なし") return null;

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

    const contentMatch = matchPageContent(combined);
    if (!contentMatch) return null;

    return {
      rowIndex: row.rowIndex,
      companyName: row.companyName,
      companyUrl: row.companyUrl,
      reason: `ページ内容に「${contentMatch.keyword}」("${contentMatch.snippet}")`,
    };
  } catch {
    return null;
  }
}

async function runPool<T>(
  items: T[],
  worker: (item: T) => Promise<void>,
  concurrency: number,
): Promise<void> {
  let index = 0;
  async function next(): Promise<void> {
    while (index < items.length) {
      const i = index++;
      await worker(items[i]);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, next));
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) {
    throw new Error("環境変数 GOOGLE_SHEET_ID が設定されていません");
  }

  const client = await createSheetsClient();
  const sheetName = await getFirstSheetName(client, spreadsheetId);
  const raw = await fetchSheetData(client, spreadsheetId, sheetName);
  const rows = parseSheetRows(raw);

  console.log(`対象: ${rows.length}社`);

  const candidates: Candidate[] = [];
  let processed = 0;
  await runPool(
    rows,
    async (row) => {
      const candidate = await screenRow(row);
      if (candidate) candidates.push(candidate);
      processed++;
      if (processed % 50 === 0) {
        console.log(`progress: ${processed}/${rows.length} (候補=${candidates.length})`);
      }
    },
    CONCURRENCY,
  );

  candidates.sort((a, b) => a.rowIndex - b.rowIndex);

  if (candidates.length === 0) {
    console.log("同業他社候補はありませんでした。");
    return;
  }

  console.log(`\n=== 同業他社候補: ${candidates.length}件 ===`);
  for (const candidate of candidates) {
    console.log(`  [行${candidate.rowIndex}] ${candidate.companyName} (${candidate.companyUrl})`);
    console.log(`    根拠: ${candidate.reason}`);
  }

  if (apply) {
    const sheetId = await getSheetId(client, spreadsheetId, sheetName);
    await deleteRows(
      client,
      spreadsheetId,
      sheetId,
      candidates.map((c) => c.rowIndex),
    );
    console.log(`\n削除しました: ${candidates.length}件`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

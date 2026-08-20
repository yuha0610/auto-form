import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import {
  createSheetsClient,
  fetchSheetData,
  getFirstSheetName,
  writeCells,
} from "../src/lib/sheetsClient.js";
import { appendNote, parseSheetRows } from "../src/lib/sheetData.js";
import {
  aggregateJobCompanies,
  matchStarclaCompanies,
  parseJobListingPage,
  parseLastPageNumber,
  type StarclaCompany,
  type StarclaMatch,
} from "../src/lib/starclaScreening.js";
import { NEVER_SEND_MARKER } from "../src/lib/targetSelection.js";
import { COLUMNS } from "../src/types.js";

const JOBS_URL = "https://startupclass.co.jp/online/jobs/";
const CACHE_PATH = "data/starcla-companies.json";
const REQUEST_INTERVAL_MS = 700;
const TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 3;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPage(page: number): Promise<string> {
  const url = page === 1 ? JOBS_URL : `${JOBS_URL}?page=${page}`;
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) await sleep(REQUEST_INTERVAL_MS * attempt);
    }
  }
  // 一部のページだけ取り落とすと、載っているのにNGが付かない企業が黙って残るため中断する
  throw new Error(`求人一覧の取得に失敗しました(${url}): ${String(lastError)}`);
}

async function fetchStarclaCompanies(): Promise<StarclaCompany[]> {
  const firstPage = await fetchPage(1);
  const lastPage = parseLastPageNumber(firstPage);
  console.log(`スタクラの求人一覧を取得する(全${lastPage}ページ)`);

  const entries = parseJobListingPage(firstPage);
  for (let page = 2; page <= lastPage; page++) {
    await sleep(REQUEST_INTERVAL_MS);
    entries.push(...parseJobListingPage(await fetchPage(page)));
    if (page % 10 === 0 || page === lastPage) console.log(`  ${page}/${lastPage}ページ`);
  }

  const companies = aggregateJobCompanies(entries);
  console.log(`求人${entries.length}件 / 掲載企業${companies.length}社`);
  return companies;
}

function loadCachedCompanies(): StarclaCompany[] {
  const companies: StarclaCompany[] = JSON.parse(readFileSync(CACHE_PATH, "utf-8"));
  console.log(`${CACHE_PATH} から掲載企業${companies.length}社を読み込んだ(再取得なし)`);
  return companies;
}

function describe(match: StarclaMatch): string {
  const row = match.row;
  const flags = [
    row.dealStatus.trim() !== "" ? `[商談中 ${row.dealStatus}]` : null,
    row.firstSentAt ? `送信済(${[row.firstSentAt, row.secondSentAt, row.thirdSentAt].filter(Boolean).join(", ")})` : "未送信",
  ].filter(Boolean);
  return `  row${row.rowIndex} | ${row.companyName} | 求人${match.company.jobCount}件 | ${flags.join(" ")} | 備考="${row.note}"`;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const fromFile = process.argv.includes("--from-file");

  const companies = fromFile ? loadCachedCompanies() : await fetchStarclaCompanies();
  if (!fromFile) {
    writeFileSync(CACHE_PATH, `${JSON.stringify(companies, null, 1)}\n`, "utf-8");
    console.log(`掲載企業を ${CACHE_PATH} に保存した`);
  }

  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw new Error("環境変数 GOOGLE_SHEET_ID が設定されていません");
  const client = await createSheetsClient();
  const sheetName = await getFirstSheetName(client, spreadsheetId);
  const raw = await fetchSheetData(client, spreadsheetId, sheetName);
  const rows = parseSheetRows(raw);

  const { candidates, alreadyMarked } = matchStarclaCompanies(companies, rows);
  const sorted = [...candidates].sort((a, b) => b.company.jobCount - a.company.jobCount);

  console.log(`\nシート${rows.length}行との照合結果`);
  console.log(`  「${NEVER_SEND_MARKER}」を付ける対象: ${sorted.length}行`);
  console.log(`  すでに付いている行: ${alreadyMarked.length}行`);
  if (sorted.length > 0) console.log(`\n--- 対象一覧`);
  for (const match of sorted) console.log(describe(match));

  if (!apply) {
    console.log(`\n(--apply なしのためシートへの書き込みはしていない)`);
    console.log(`確認した内容のまま反映するには: npm run screen:starcla -- --apply --from-file`);
    return;
  }

  const writes = sorted.map((match) => ({
    rowIndex: match.row.rowIndex,
    columnName: COLUMNS.note,
    value: appendNote(match.row.note, NEVER_SEND_MARKER),
  }));
  await writeCells(client, spreadsheetId, sheetName, writes, raw.headerRow);
  console.log(`\n書き込み完了: ${writes.length}行の備考に「${NEVER_SEND_MARKER}」を追記した`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

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
  parseCompanyListingPage,
  parseCompanyPage,
  parseJobListingPage,
  parseLastPageNumber,
  type StarclaCompany,
  type StarclaMatch,
} from "../src/lib/starclaScreening.js";
import { NEVER_SEND_MARKER } from "../src/lib/targetSelection.js";
import { COLUMNS } from "../src/types.js";

const JOBS_URL = "https://startupclass.co.jp/online/jobs/";
const COMPANIES_URL = "https://startupclass.co.jp/online/companies/";
const CACHE_PATH = "data/starcla-companies.json";
const REQUEST_INTERVAL_MS = 700;
const TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 3;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchHtml(url: string): Promise<string> {
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
  throw new Error(`ページの取得に失敗しました(${url}): ${String(lastError)}`);
}

/** ページ送りのある一覧を最終ページまで取得する。 */
async function fetchListing(
  baseUrl: string,
  label: string,
  parsePage: (html: string) => { id: string; name: string }[],
): Promise<{ id: string; name: string }[]> {
  const firstPage = await fetchHtml(baseUrl);
  const lastPage = parseLastPageNumber(firstPage);
  console.log(`${label}を取得する(全${lastPage}ページ)`);

  const entries = parsePage(firstPage);
  for (let page = 2; page <= lastPage; page++) {
    await sleep(REQUEST_INTERVAL_MS);
    entries.push(...parsePage(await fetchHtml(`${baseUrl}?page=${page}`)));
    if (page % 10 === 0 || page === lastPage) console.log(`  ${page}/${lastPage}ページ`);
  }
  return entries;
}

/** 各企業ページの「会社概要」から正式な会社名と会社URLを補う。 */
async function fillCompanyDetails(companies: StarclaCompany[]): Promise<void> {
  const estimateMinutes = Math.ceil((companies.length * REQUEST_INTERVAL_MS) / 60_000);
  console.log(`企業ページから会社URLを取得する(${companies.length}社・約${estimateMinutes}分)`);
  let done = 0;
  for (const company of companies) {
    const page = parseCompanyPage(await fetchHtml(`${COMPANIES_URL}${company.id}/`));
    if (page.name) company.name = page.name;
    company.url = page.url;
    done += 1;
    if (done % 50 === 0 || done === companies.length) console.log(`  ${done}/${companies.length}社`);
    await sleep(REQUEST_INTERVAL_MS);
  }
  const withUrl = companies.filter((company) => company.url).length;
  console.log(`  会社URLが取れた企業: ${withUrl}/${companies.length}社`);
}

async function fetchStarclaCompanies(
  includeNotHiring: boolean,
  withUrls: boolean,
): Promise<StarclaCompany[]> {
  const jobEntries = await fetchListing(JOBS_URL, "スタクラの求人一覧", parseJobListingPage);
  const companies = aggregateJobCompanies(jobEntries);
  console.log(`求人${jobEntries.length}件 / 求人掲載中の企業${companies.length}社`);

  if (includeNotHiring) {
    const listed = await fetchListing(COMPANIES_URL, "スタクラの企業一覧", parseCompanyListingPage);
    const known = new Set(companies.map((company) => company.id));
    let added = 0;
    for (const entry of listed) {
      if (known.has(entry.id)) continue;
      known.add(entry.id);
      companies.push({ id: entry.id, name: entry.name, jobCount: 0 });
      added += 1;
    }
    console.log(`求人は出ていない掲載企業を${added}社追加した(合計${companies.length}社)`);
  }

  if (withUrls) await fillCompanyDetails(companies);
  return companies;
}

function loadCachedCompanies(): StarclaCompany[] {
  const companies: StarclaCompany[] = JSON.parse(readFileSync(CACHE_PATH, "utf-8"));
  console.log(`${CACHE_PATH} から掲載企業${companies.length}社を読み込んだ(再取得なし)`);
  return companies;
}

function describe(match: StarclaMatch): string {
  const row = match.row;
  const sentAt = [row.firstSentAt, row.secondSentAt, row.thirdSentAt].filter(Boolean);
  const flags = [
    row.dealStatus.trim() !== "" ? `[商談中 ${row.dealStatus}]` : null,
    sentAt.length > 0 ? `送信済(${sentAt.join(", ")})` : "未送信",
  ].filter(Boolean);
  const jobs = match.company.jobCount > 0 ? `求人${match.company.jobCount}件` : "求人なし";
  return `  row${row.rowIndex} | ${row.companyName} | ${jobs} | ${flags.join(" ")} | 備考="${row.note}"`;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const fromFile = process.argv.includes("--from-file");
  const includeNotHiring = process.argv.includes("--include-not-hiring");
  const skipUrls = process.argv.includes("--skip-urls");

  const companies = fromFile
    ? loadCachedCompanies()
    : await fetchStarclaCompanies(includeNotHiring, !skipUrls);
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

  const { candidates, alreadyMarked, conflicts } = matchStarclaCompanies(companies, rows);
  const sorted = [...candidates].sort((a, b) => b.company.jobCount - a.company.jobCount);

  console.log(`\nシート${rows.length}行との照合結果`);
  console.log(`  「${NEVER_SEND_MARKER}」を付ける対象: ${sorted.length}行`);
  console.log(`  すでに付いている行: ${alreadyMarked.length}行`);
  console.log(`  社名は一致するがURLが食い違う行(同名の別会社の可能性・対象外): ${conflicts.length}行`);
  if (sorted.length > 0) console.log(`\n--- 対象一覧`);
  for (const match of sorted) console.log(describe(match));

  if (conflicts.length > 0) {
    console.log(`\n--- 要確認(社名だけ一致・URLが食い違うため自動ではNGにしない)`);
    for (const match of conflicts) {
      console.log(
        `  row${match.row.rowIndex} | ${match.row.companyName} (${match.row.companyUrl || "URLなし"})` +
          ` <-> スタクラ「${match.company.name}」(${match.company.url ?? "URLなし"})` +
          ` | 備考="${match.row.note}"`,
      );
    }
  }

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

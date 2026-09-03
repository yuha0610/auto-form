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
  listedMarker,
  matchListedCompanies,
  selectListedStocks,
  type ListedCompany,
  type ListedMatch,
} from "../src/lib/listedScreening.js";
import { readXlsxRows } from "../src/lib/xlsx.js";
import { COLUMNS } from "../src/types.js";

/** JPXが日次で更新している「東証上場銘柄一覧」。 */
const JPX_XLSX_URL =
  "https://www.jpx.co.jp/markets/statistics-equities/misc/tvdivq0000001vg2-att/data_j.xlsx";
const CACHE_PATH = "data/listed-companies.json";
const TIMEOUT_MS = 30_000;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

async function fetchListedCompanies(): Promise<ListedCompany[]> {
  console.log("JPXの東証上場銘柄一覧を取得する");
  const res = await fetch(JPX_XLSX_URL, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    // 一覧を取り落としたまま進むと、上場しているのにNGが付かない企業が黙って残る
    throw new Error(`銘柄一覧の取得に失敗しました(HTTP ${res.status}): ${JPX_XLSX_URL}`);
  }

  const rows = readXlsxRows(Buffer.from(await res.arrayBuffer()));
  const companies = selectListedStocks(rows);
  console.log(`  全${rows.length - 1}銘柄 / 株式として上場している企業${companies.length}社`);
  return companies;
}

function loadCachedCompanies(): ListedCompany[] {
  const companies: ListedCompany[] = JSON.parse(readFileSync(CACHE_PATH, "utf-8"));
  console.log(`${CACHE_PATH} から上場企業${companies.length}社を読み込んだ(再取得なし)`);
  return companies;
}

function describe(match: ListedMatch): string {
  const row = match.row;
  const sentAt = [row.firstSentAt, row.secondSentAt, row.thirdSentAt].filter(Boolean);
  const flags = [
    row.dealStatus.trim() !== "" ? `[商談中 ${row.dealStatus}]` : null,
    sentAt.length > 0 ? `送信済(${sentAt.join(", ")})` : "未送信",
  ].filter(Boolean);
  return (
    `  row${row.rowIndex} | ${row.companyName} (${row.companyUrl || "URLなし"})` +
    ` <-> ${match.company.code} ${match.company.name} [${match.company.market}]` +
    ` | ${flags.join(" ")} | 備考="${row.note}"`
  );
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const fromFile = process.argv.includes("--from-file");

  const companies = fromFile ? loadCachedCompanies() : await fetchListedCompanies();
  if (!fromFile) {
    writeFileSync(CACHE_PATH, `${JSON.stringify(companies, null, 1)}\n`, "utf-8");
    console.log(`上場企業を ${CACHE_PATH} に保存した`);
  }

  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw new Error("環境変数 GOOGLE_SHEET_ID が設定されていません");
  const client = await createSheetsClient();
  const sheetName = await getFirstSheetName(client, spreadsheetId);
  const raw = await fetchSheetData(client, spreadsheetId, sheetName);
  const rows = parseSheetRows(raw);

  const { candidates, alreadyMarked } = matchListedCompanies(companies, rows);
  const sorted = [...candidates].sort((a, b) => a.row.rowIndex - b.row.rowIndex);

  console.log(`\nシート${rows.length}行との照合結果`);
  console.log(`  「送信NG」を付ける対象: ${sorted.length}行`);
  console.log(`  すでに付いている行: ${alreadyMarked.length}行`);

  if (sorted.length > 0) {
    console.log(`\n--- 対象一覧`);
    for (const match of sorted) console.log(describe(match));
    console.log(
      `\n照合は社名だけで行っている(JPXの一覧に企業URLが無いため)。` +
        `同名の別会社が混ざっていないか、企業URLを見て確かめてから反映すること。`,
    );
  }

  if (!apply) {
    console.log(`\n(--apply なしのためシートへの書き込みはしていない)`);
    console.log(`確認した内容のまま反映するには: npm run screen:listed -- --apply --from-file`);
    return;
  }

  const writes = sorted.map((match) => ({
    rowIndex: match.row.rowIndex,
    columnName: COLUMNS.note,
    value: appendNote(match.row.note, listedMarker(match.company)),
  }));
  await writeCells(client, spreadsheetId, sheetName, writes, raw.headerRow);
  console.log(`\n書き込み完了: ${writes.length}行の備考に上場を理由とする「送信NG」を追記した`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

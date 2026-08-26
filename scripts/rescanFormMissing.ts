import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { chromium, type Browser } from "playwright";
import {
  createSheetsClient,
  fetchSheetData,
  getFirstSheetName,
  writeCells,
} from "../src/lib/sheetsClient.js";
import { parseSheetRows } from "../src/lib/sheetData.js";
import { findContactLink, type ContactLink } from "../src/lib/formDiscovery.js";
import { planRescanWrites } from "../src/lib/formRescan.js";
import { gotoWithRetry } from "../src/lib/navigation.js";
import { COLUMNS, type SheetRowData } from "../src/types.js";

const CACHE_PATH = "data/form-rescan-results.json";
const FORM_MISSING_MARKER = "フォーム無";
const CONCURRENCY = 4;
const PAGE_TIMEOUT_MS = 25_000;

/** 1社分の再スキャン結果。途中で落ちても再開できるようファイルに残す。 */
interface ScanResult {
  rowIndex: number;
  companyName: string;
  link: ContactLink | null;
  /** サイトに到達できなかった場合の理由。到達できた場合はnull */
  error: string | null;
}

function loadCache(): ScanResult[] {
  if (!existsSync(CACHE_PATH)) return [];
  return JSON.parse(readFileSync(CACHE_PATH, "utf-8")) as ScanResult[];
}

function saveCache(results: ScanResult[]): void {
  writeFileSync(CACHE_PATH, `${JSON.stringify(results, null, 1)}\n`, "utf-8");
}

async function scanOne(browser: Browser, row: SheetRowData): Promise<ScanResult> {
  const page = await browser.newPage();
  page.setDefaultTimeout(PAGE_TIMEOUT_MS);
  try {
    await gotoWithRetry(page, row.companyUrl, { waitUntil: "domcontentloaded" });
    const link = await findContactLink(page);
    return { rowIndex: row.rowIndex, companyName: row.companyName, link, error: null };
  } catch (error) {
    return {
      rowIndex: row.rowIndex,
      companyName: row.companyName,
      link: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * 複数のタブで並行してスキャンする。
 * 1社ごとに結果をファイルへ書き出し、途中で止まっても再開できるようにする。
 */
async function scanAll(rows: SheetRowData[], done: ScanResult[]): Promise<ScanResult[]> {
  const results = [...done];
  const scanned = new Set(done.map((result) => result.rowIndex));
  const queue = rows.filter((row) => !scanned.has(row.rowIndex));
  if (queue.length === 0) return results;

  const estimateMinutes = Math.ceil((queue.length * 5) / 60 / CONCURRENCY);
  console.log(`${queue.length}社をスキャンする(同時${CONCURRENCY}タブ・約${estimateMinutes}分)`);

  const browser = await chromium.launch({ headless: true });
  let next = 0;
  try {
    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (next < queue.length) {
        const row = queue[next++];
        results.push(await scanOne(browser, row));
        saveCache(results);
        if (results.length % 25 === 0) {
          console.log(`  ${results.length}/${rows.length}社`);
        }
      }
    });
    await Promise.all(workers);
  } finally {
    await browser.close();
  }
  console.log(`  ${results.length}/${rows.length}社 完了`);
  return results;
}

const KIND_LABEL: Record<ContactLink["kind"], string> = {
  form: "フォームが見つかった(別ページ)",
  "same-page": "フォームが見つかった(同一ページ)",
  email: "メールアドレスだった",
  "google-form": "Google Formだった",
};

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const fromFile = process.argv.includes("--from-file");

  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw new Error("環境変数 GOOGLE_SHEET_ID が設定されていません");
  const client = await createSheetsClient();
  const sheetName = await getFirstSheetName(client, spreadsheetId);
  const raw = await fetchSheetData(client, spreadsheetId, sheetName);
  const rows = parseSheetRows(raw);

  const targets = rows.filter(
    (row) => row.note.includes(FORM_MISSING_MARKER) && row.companyUrl.trim() !== "",
  );
  console.log(`「${FORM_MISSING_MARKER}」かつ企業URLがある行: ${targets.length}社`);

  const cached = loadCache();
  if (fromFile) {
    console.log(`${CACHE_PATH} から${cached.length}社分の結果を読み込んだ(再スキャンなし)`);
  } else if (cached.length > 0) {
    console.log(`${CACHE_PATH} に${cached.length}社分の結果がある。残りだけスキャンする`);
  }
  const results = fromFile ? cached : await scanAll(targets, cached);

  const rowByIndex = new Map(targets.map((row) => [row.rowIndex, row]));
  const writes: { rowIndex: number; columnName: string; value: string }[] = [];
  const tally = new Map<string, number>();
  const unreachable: ScanResult[] = [];
  const stillMissing: ScanResult[] = [];
  const recovered: string[] = [];

  for (const result of results) {
    const row = rowByIndex.get(result.rowIndex);
    // シートが編集されて対象から外れた行は黙って飛ばさず数える
    if (!row) continue;
    if (result.error) {
      unreachable.push(result);
      continue;
    }

    const planned = planRescanWrites(row, result.link);
    if (!planned) {
      stillMissing.push(result);
      continue;
    }

    tally.set(KIND_LABEL[planned.kind], (tally.get(KIND_LABEL[planned.kind]) ?? 0) + 1);
    if (planned.formUrl) {
      writes.push({ rowIndex: row.rowIndex, columnName: COLUMNS.formUrl, value: planned.formUrl });
    }
    if (planned.email) {
      writes.push({ rowIndex: row.rowIndex, columnName: COLUMNS.email, value: planned.email });
    }
    writes.push({ rowIndex: row.rowIndex, columnName: COLUMNS.note, value: planned.note });

    if (planned.kind === "form" || planned.kind === "same-page") {
      recovered.push(`  row${row.rowIndex} | ${row.companyName} | ${planned.formUrl ?? row.formUrl}`);
    }
  }

  console.log(`\n=== 再スキャン結果 ===`);
  for (const [label, count] of tally) console.log(`  ${label}: ${count}社`);
  console.log(`  やはり見つからない: ${stillMissing.length}社`);
  console.log(`  サイトに到達できない: ${unreachable.length}社`);

  const sendable = (tally.get(KIND_LABEL.form) ?? 0) + (tally.get(KIND_LABEL["same-page"]) ?? 0);
  console.log(`\n送信対象に戻る企業: ${sendable}社(${writes.length}セルを書き換える)`);
  if (recovered.length > 0) {
    console.log(`\n--- 送信対象に戻る企業\n${recovered.join("\n")}`);
  }
  if (unreachable.length > 0) {
    console.log(`\n--- サイトに到達できない(備考はそのまま)`);
    for (const result of unreachable) {
      console.log(`  row${result.rowIndex} | ${result.companyName} | ${result.error}`);
    }
  }

  if (!apply) {
    console.log(`\n(--apply なしのためシートへの書き込みはしていない)`);
    console.log(`確認した内容のまま反映するには: npm run rescan:form-missing -- --apply --from-file`);
    return;
  }
  if (writes.length === 0) {
    console.log(`\n書き込む対象がないため何もしなかった`);
    return;
  }

  await writeCells(client, spreadsheetId, sheetName, writes, raw.headerRow);
  console.log(`\n書き込み完了: ${writes.length}セルを更新した`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import {
  createSheetsClient,
  fetchSheetData,
  getFirstSheetName,
  writeCells,
} from "../src/lib/sheetsClient.js";
import { appendNote, parseSheetRows } from "../src/lib/sheetData.js";
import { resolveOverviewUrl } from "../src/lib/competitorScreening.js";
import { NEVER_SEND_MARKER } from "../src/lib/targetSelection.js";
import {
  matchTalentCompanyName,
  matchTalentPageContent,
  selectTalentCandidates,
  talentMarker,
  type TalentRowMatch,
} from "../src/lib/talentScreening.js";
import { COLUMNS, type SheetRowData } from "../src/types.js";

const CACHE_PATH = "data/talent-candidates.json";
const CONCURRENCY = 8;
const TIMEOUT_MS = 10_000;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

/** 目視確認した内容をそのまま反映するために、判定結果を保存しておく形。 */
interface CachedCandidate {
  rowIndex: number;
  companyName: string;
  companyUrl: string;
  keyword: string;
  snippet: string;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "follow",
  });
  return await res.text();
}

async function screenRow(row: SheetRowData): Promise<TalentRowMatch | null> {
  const nameKeyword = matchTalentCompanyName(row.companyName);
  if (nameKeyword) {
    return { row, match: { keyword: nameKeyword, snippet: `社名: ${row.companyName}` } };
  }

  // すでに送信NGの行はどうせ印を足さないので、サイトまで取りに行かない
  if (row.note.includes(NEVER_SEND_MARKER)) return null;
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

    const match = matchTalentPageContent(combined);
    return match ? { row, match } : null;
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
      await worker(items[index++]);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, next));
}

function describe(entry: TalentRowMatch): string {
  const row = entry.row;
  const sentAt = [row.firstSentAt, row.secondSentAt, row.thirdSentAt].filter(Boolean);
  const state = sentAt.length > 0 ? `送信済(${sentAt.join(", ")})` : "未送信";
  return (
    `  row${row.rowIndex} | ${row.companyName} (${row.companyUrl || "URLなし"}) | ${state}\n` +
    `    根拠: 「${entry.match.keyword}」 "${entry.match.snippet}"`
  );
}

/**
 * 保存した候補を、現在のシートの行と突き合わせ直す。
 * 行の削除・追加で行番号はずれるので、社名が変わっていたら中断して人に判断を戻す。
 */
function restoreFromCache(rows: SheetRowData[]): TalentRowMatch[] {
  const cached: CachedCandidate[] = JSON.parse(readFileSync(CACHE_PATH, "utf-8"));
  const byRowIndex = new Map(rows.map((row) => [row.rowIndex, row]));

  return cached.map((entry) => {
    const row = byRowIndex.get(entry.rowIndex);
    if (!row) {
      throw new Error(
        `row${entry.rowIndex}(${entry.companyName})がシートに見つかりません。` +
          `行がずれている可能性があるので、--from-file を外して取り直してください。`,
      );
    }
    if (row.companyName !== entry.companyName) {
      throw new Error(
        `row${entry.rowIndex}の社名が「${entry.companyName}」から「${row.companyName}」に変わっています。` +
          `行がずれている可能性があるので、--from-file を外して取り直してください。`,
      );
    }
    return { row, match: { keyword: entry.keyword, snippet: entry.snippet } };
  });
}

async function scanRows(rows: SheetRowData[]): Promise<TalentRowMatch[]> {
  const matches: TalentRowMatch[] = [];
  let processed = 0;
  await runPool(
    rows,
    async (row) => {
      const match = await screenRow(row);
      if (match) matches.push(match);
      processed++;
      if (processed % 100 === 0) {
        console.log(`progress: ${processed}/${rows.length} (候補=${matches.length})`);
      }
    },
    CONCURRENCY,
  );
  return matches;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const fromFile = process.argv.includes("--from-file");

  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw new Error("環境変数 GOOGLE_SHEET_ID が設定されていません");

  const client = await createSheetsClient();
  const sheetName = await getFirstSheetName(client, spreadsheetId);
  const raw = await fetchSheetData(client, spreadsheetId, sheetName);
  const rows = parseSheetRows(raw);

  let matches: TalentRowMatch[];
  if (fromFile) {
    matches = restoreFromCache(rows);
    console.log(`${CACHE_PATH} から候補${matches.length}件を読み込んだ(再判定なし)`);
  } else {
    console.log(`対象: ${rows.length}行のサイトを見て芸能・タレント業かを判定する`);
    matches = await scanRows(rows);
  }

  const { candidates, alreadyMarked } = selectTalentCandidates(matches);
  const sorted = [...candidates].sort((a, b) => a.row.rowIndex - b.row.rowIndex);

  console.log(`\n判定結果`);
  console.log(`  「${talentMarker()}」を付ける対象: ${sorted.length}行`);
  console.log(`  すでに送信NGが付いている行: ${alreadyMarked.length}行`);

  if (sorted.length > 0) {
    console.log(`\n--- 対象一覧`);
    for (const entry of sorted) console.log(describe(entry));
    console.log(
      `\nキーワード一致での判定なので、芸能・タレント業向けにサービスを売っている企業を` +
        `巻き込むことがある。根拠のスニペットを見て確かめてから反映すること。`,
    );
  }

  if (!apply) {
    if (!fromFile) {
      const cached: CachedCandidate[] = sorted.map((entry) => ({
        rowIndex: entry.row.rowIndex,
        companyName: entry.row.companyName,
        companyUrl: entry.row.companyUrl,
        keyword: entry.match.keyword,
        snippet: entry.match.snippet,
      }));
      writeFileSync(CACHE_PATH, `${JSON.stringify(cached, null, 1)}\n`, "utf-8");
      console.log(`\n候補を ${CACHE_PATH} に保存した`);
    }
    console.log(`(--apply なしのためシートへの書き込みはしていない)`);
    console.log(`確認した内容のまま反映するには: npm run screen:talent -- --apply --from-file`);
    return;
  }

  if (sorted.length === 0) {
    console.log(`\n書き込む対象がないので何もしていない`);
    return;
  }

  const writes = sorted.map((entry) => ({
    rowIndex: entry.row.rowIndex,
    columnName: COLUMNS.note,
    value: appendNote(entry.row.note, talentMarker()),
  }));
  await writeCells(client, spreadsheetId, sheetName, writes, raw.headerRow);
  console.log(`\n書き込み完了: ${writes.length}行の備考にタレント業を理由とする「送信NG」を追記した`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

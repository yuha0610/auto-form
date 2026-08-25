import "dotenv/config";
import {
  createSheetsClient,
  fetchSheetData,
  getFirstSheetName,
  writeCells,
} from "../src/lib/sheetsClient.js";
import { parseSheetRows } from "../src/lib/sheetData.js";
import {
  parseSkipMarkArgs,
  planSkipMarks,
  resolveSkipReason,
  type SkipMarkPlan,
} from "../src/lib/skipMarking.js";
import { SKIP_MARKERS } from "../src/lib/targetSelection.js";
import { COLUMNS } from "../src/types.js";
import type { SheetRowData } from "../src/types.js";

const USAGE = `使い方:
  npm run mark:skip -- <URL...>                     確認のみ(既定の印は「送信NG」)
  npm run mark:skip -- <URL...> --apply             シートに書き込む
  npm run mark:skip -- <URL...> --reason CAPTCHA --apply

URLはスペース・カンマ・改行のどれで区切っても構わない。
会社URL・フォームURLのどちらを貼っても同じ行に突き合わせる。
使える印: ${SKIP_MARKERS.join(" / ")}`;

function describe(row: SheetRowData): string {
  const sentAt = [row.firstSentAt, row.secondSentAt, row.thirdSentAt].filter(Boolean);
  const flags = [
    row.dealStatus.trim() !== "" ? `[商談中 ${row.dealStatus}]` : null,
    sentAt.length > 0 ? `送信済(${sentAt.join(", ")})` : "未送信",
  ].filter(Boolean);
  return `row${row.rowIndex} | ${row.companyName} | ${flags.join(" ")} | 備考="${row.note}"`;
}

function report(plan: SkipMarkPlan, marker: string): void {
  console.log(`\n付ける印: 「${marker}」`);
  console.log(`  対象: ${plan.targets.length}行`);
  console.log(`  すでに付いている行: ${plan.alreadyMarked.length}行`);
  console.log(`  一致した行が絞れなかったURL: ${plan.ambiguous.length}件`);
  console.log(`  一致しなかったURL: ${plan.unmatched.length}件`);

  if (plan.targets.length > 0) {
    console.log(`\n--- 対象一覧`);
    for (const target of plan.targets) {
      console.log(`  ${describe(target.row)}`);
      console.log(`      ${target.url}`);
      console.log(`      備考を "${target.newNote}" にする`);
    }
  }

  if (plan.alreadyMarked.length > 0) {
    console.log(`\n--- すでに「${marker}」が付いている(書き込み不要)`);
    for (const marked of plan.alreadyMarked) console.log(`  ${describe(marked.row)}`);
  }

  // 取り違えたまま書き込むと関係のない企業を送信対象から外してしまうため、人が判断する
  if (plan.ambiguous.length > 0) {
    console.log(`\n--- 要確認(同じホストの行が複数あり自動では書き込まない)`);
    for (const item of plan.ambiguous) {
      console.log(`  ${item.url}`);
      for (const row of item.rows) console.log(`      ${describe(row)}`);
    }
  }

  if (plan.unmatched.length > 0) {
    console.log(`\n--- シートに見つからなかったURL`);
    for (const url of plan.unmatched) console.log(`  ${url}`);
  }
}

async function main(): Promise<void> {
  const { urls, reason, apply } = parseSkipMarkArgs(process.argv.slice(2));
  if (urls.trim() === "") {
    console.log(USAGE);
    return;
  }
  const marker = resolveSkipReason(reason);

  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw new Error("環境変数 GOOGLE_SHEET_ID が設定されていません");
  const client = await createSheetsClient();
  const sheetName = await getFirstSheetName(client, spreadsheetId);
  const raw = await fetchSheetData(client, spreadsheetId, sheetName);
  const rows = parseSheetRows(raw);

  const plan = planSkipMarks(urls, rows, marker);
  report(plan, marker);

  if (!apply) {
    console.log(`\n(--apply なしのためシートへの書き込みはしていない)`);
    return;
  }
  if (plan.targets.length === 0) {
    console.log(`\n書き込む対象がないため何もしなかった`);
    return;
  }

  const writes = plan.targets.map((target) => ({
    rowIndex: target.row.rowIndex,
    columnName: COLUMNS.note,
    value: target.newNote,
  }));
  await writeCells(client, spreadsheetId, sheetName, writes, raw.headerRow);
  console.log(`\n書き込み完了: ${writes.length}行の備考に「${marker}」を追記した`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

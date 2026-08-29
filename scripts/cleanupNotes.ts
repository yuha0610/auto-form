import "dotenv/config";
import {
  createSheetsClient,
  fetchSheetData,
  getFirstSheetName,
  writeCells,
} from "../src/lib/sheetsClient.js";
import { parseSheetRows } from "../src/lib/sheetData.js";
import { planNoteCleanup } from "../src/lib/noteCleanup.js";
import { COLUMNS } from "../src/types.js";

const USAGE = `使い方:
  npm run cleanup:notes            確認のみ
  npm run cleanup:notes -- --apply シートに書き込む

失敗のたびに積み上がった備考を整理する。
同じ印は1つにまとめ、一時的な失敗(タイムアウト・接続エラー)を2回以上繰り返した行には
「接続不可」を付けて次回以降のバッチから外す。`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(USAGE);
    return;
  }
  const apply = args.includes("--apply");

  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw new Error("環境変数 GOOGLE_SHEET_ID が設定されていません");
  const client = await createSheetsClient();
  const sheetName = await getFirstSheetName(client, spreadsheetId);
  const raw = await fetchSheetData(client, spreadsheetId, sheetName);
  const rows = parseSheetRows(raw);

  const targets = planNoteCleanup(rows);
  console.log(`\n=== 整理する行: ${targets.length}件 ===`);
  for (const target of targets) {
    console.log(`  row${target.row.rowIndex} | ${target.row.companyName} | ${target.summary}`);
    console.log(`      "${target.row.note}"`);
    console.log(`   -> "${target.newNote}"`);
  }

  if (!apply) {
    console.log(`\n(--apply なしのためシートへの書き込みはしていない)`);
    return;
  }
  if (targets.length === 0) {
    console.log(`\n整理する行がないため何もしなかった`);
    return;
  }
  const writes = targets.map((target) => ({
    rowIndex: target.row.rowIndex,
    columnName: COLUMNS.note,
    value: target.newNote,
  }));
  await writeCells(client, spreadsheetId, sheetName, writes, raw.headerRow);
  console.log(`\n書き込み完了: ${writes.length}行の備考を整理した`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

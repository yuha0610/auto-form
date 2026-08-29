import "dotenv/config";
import { writeFileSync } from "node:fs";
import {
  createSheetsClient,
  fetchSheetData,
  getFirstSheetName,
} from "../src/lib/sheetsClient.js";
import { parseSheetRows } from "../src/lib/sheetData.js";
import { selectUncertainRows } from "../src/lib/uncertainRows.js";

const DEFAULT_OUTPUT = "data/uncertain-rows.csv";

const USAGE = `使い方:
  npm run list:uncertain              ${DEFAULT_OUTPUT} に書き出す
  npm run list:uncertain -- <ファイル> 書き出し先を指定する

送信日は入っているが、送信できたかの確認が取れていない行を一覧にする。
シートは変更しない(読み取りのみ)。`;

/** Excel/スプレッドシートでそのまま開けるようにCSVとして正しく囲む。 */
function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(USAGE);
    return;
  }
  const outputPath = args.find((arg) => !arg.startsWith("--")) ?? DEFAULT_OUTPUT;

  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw new Error("環境変数 GOOGLE_SHEET_ID が設定されていません");
  const client = await createSheetsClient();
  const sheetName = await getFirstSheetName(client, spreadsheetId);
  const rows = parseSheetRows(await fetchSheetData(client, spreadsheetId, sheetName));

  const uncertain = selectUncertainRows(rows);

  const header = ["行番号", "企業名", "企業URL", "フォームURL", "確認する回", "その回の日付", "1回目", "2回目", "3回目", "備考"];
  const lines = [header.map(csvCell).join(",")];
  for (const row of uncertain) {
    lines.push(
      [
        String(row.rowIndex),
        row.companyName,
        row.companyUrl,
        row.formUrl,
        `${row.lastAttempt.number}回目`,
        row.lastAttempt.sentAt,
        row.firstSentAt ?? "",
        row.secondSentAt ?? "",
        row.thirdSentAt ?? "",
        row.note,
      ].map(csvCell).join(","),
    );
  }
  writeFileSync(outputPath, `﻿${lines.join("\n")}\n`, "utf-8");

  const byAttempt = new Map<number, number>();
  for (const row of uncertain) {
    byAttempt.set(row.lastAttempt.number, (byAttempt.get(row.lastAttempt.number) ?? 0) + 1);
  }
  console.log(`\n送信できたか確認が取れていない行: ${uncertain.length}件`);
  for (const number of [1, 2, 3]) {
    const count = byAttempt.get(number) ?? 0;
    if (count > 0) console.log(`  ${number}回目まで進んだ行: ${count}件`);
  }
  console.log(`\n${outputPath} に書き出した`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

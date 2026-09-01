import "dotenv/config";
import { writeFileSync } from "node:fs";
import {
  createSheetsClient,
  fetchSheetData,
  getFirstSheetName,
} from "../src/lib/sheetsClient.js";
import { parseSheetRows } from "../src/lib/sheetData.js";
import { findDomainDuplicates } from "../src/lib/domainDuplicates.js";
import type { SheetRowData } from "../src/types.js";

const DEFAULT_OUTPUT = "data/domain-duplicates.json";

const USAGE = `使い方:
  npm run check:duplicates              ${DEFAULT_OUTPUT} に書き出す
  npm run check:duplicates -- <ファイル> 書き出し先を指定する

同じドメイン(または共有フォームサービス上の同じURL)を指している行を洗い出す。
企業名のコア名で突き合わせる cleanup:company-names とは別の観点で、
社名変更やフォームURLの誤登録による重複を見つけるためのもの。
シートは変更しない(読み取りのみ)。`;

function sentSummary(row: SheetRowData): string {
  return [row.firstSentAt, row.secondSentAt, row.thirdSentAt]
    .filter((value): value is string => value !== null && value.trim() !== "")
    .join(" / ");
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

  const groups = findDomainDuplicates(rows);
  const nameMismatch = groups.filter((group) => !group.sameCoreName);
  const nameMatch = groups.filter((group) => group.sameCoreName);

  console.log(`全${rows.length}行を走査`);
  console.log(`同一ドメインで社名が違うグループ: ${nameMismatch.length}件 (cleanup:company-names では拾えない)`);
  console.log(`同一ドメインで社名も同じグループ: ${nameMatch.length}件 (cleanup:company-names が拾える範囲)`);

  if (nameMismatch.length > 0) {
    console.log("\n=== 同一ドメイン・社名違い(要確認) ===");
    for (const group of nameMismatch) {
      const sentCount = group.rows.filter((row) => sentSummary(row) !== "").length;
      const flag = sentCount >= 2 ? " ★重複送信済み" : sentCount === 1 ? " (片方送信済み)" : "";
      console.log(`\n[${group.key}]${flag}`);
      for (const row of group.rows) {
        const extras = [
          row.dealStatus ? `商談=${row.dealStatus}` : null,
          row.note ? `備考=${row.note}` : null,
        ].filter(Boolean);
        console.log(
          `  行${row.rowIndex} ${row.companyName} | 企業URL=${row.companyUrl || "-"} | フォーム=${row.formUrl || "-"} | 送信=${sentSummary(row) || "未"}${extras.length > 0 ? ` | ${extras.join(" | ")}` : ""}`,
        );
      }
    }
  }

  const serialize = (list: typeof groups) =>
    list.map((group) => ({
      key: group.key,
      sameCoreName: group.sameCoreName,
      rows: group.rows.map((row) => ({
        rowIndex: row.rowIndex,
        companyName: row.companyName,
        companyUrl: row.companyUrl,
        formUrl: row.formUrl,
        sent: sentSummary(row),
        dealStatus: row.dealStatus,
        note: row.note,
      })),
    }));

  writeFileSync(
    outputPath,
    `${JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        totalRows: rows.length,
        nameMismatch: serialize(nameMismatch),
        nameMatch: serialize(nameMatch),
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );
  console.log(`\n${outputPath} に書き出しました。`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import "dotenv/config";
import { readFileSync } from "node:fs";
import {
  createSheetsClient,
  fetchSheetData,
  getFirstSheetName,
  writeCells,
} from "../src/lib/sheetsClient.js";
import { parseSheetRows } from "../src/lib/sheetData.js";
import { parseRecordEntries, planOutcomeRecords } from "../src/lib/outcomeRecording.js";
import { SKIP_MARKERS } from "../src/lib/targetSelection.js";
import type { SheetRowData } from "../src/types.js";

const USAGE = `使い方:
  npm run record -- <ファイル>            確認のみ
  npm run record -- <ファイル> --apply    シートに書き込む

ファイルはJSONの配列で、1件ごとに結果を書く。
  url      突き合わせに使うURL(会社URL・フォームURLのどちらでもよい)
  outcome  sent / email / failed / skip / form-url
  formUrl  保存するフォームURL(sent / failed / form-url)
  email    保存するメールアドレス(email)
  reason   付けるスキップ印(skip): ${SKIP_MARKERS.join(" / ")}

例:
[
  { "url": "https://example.com/", "outcome": "sent", "formUrl": "https://example.com/contact" },
  { "url": "https://other.example/", "outcome": "skip", "reason": "送信NG" }
]`;

function describe(row: SheetRowData): string {
  const sentAt = [row.firstSentAt, row.secondSentAt, row.thirdSentAt].filter(Boolean);
  return `row${row.rowIndex} | ${row.companyName} | ${sentAt.length > 0 ? `送信済(${sentAt.join(", ")})` : "未送信"} | 備考="${row.note}"`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const path = args.find((arg) => !arg.startsWith("--"));
  if (!path) {
    console.log(USAGE);
    return;
  }

  const entries = parseRecordEntries(readFileSync(path, "utf-8"));
  console.log(`${path} から${entries.length}件の結果を読み込んだ`);

  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw new Error("環境変数 GOOGLE_SHEET_ID が設定されていません");
  const client = await createSheetsClient();
  const sheetName = await getFirstSheetName(client, spreadsheetId);
  const raw = await fetchSheetData(client, spreadsheetId, sheetName);
  const rows = parseSheetRows(raw);

  const plan = planOutcomeRecords(entries, rows, new Date());

  console.log(`\n=== 反映内容 ===`);
  console.log(`  書き込む行: ${plan.targets.length}`);
  console.log(`  すでに反映済み: ${plan.alreadyDone.length}`);
  console.log(`  行を絞れなかったURL: ${plan.ambiguous.length}`);
  console.log(`  一致しなかったURL: ${plan.unmatched.length}`);
  console.log(`  書き込めなかった指定: ${plan.errors.length}`);

  if (plan.targets.length > 0) {
    console.log(`\n--- 書き込む行`);
    for (const target of plan.targets) {
      console.log(`  ${describe(target.row)}`);
      console.log(`      [${target.entry.outcome}] ${target.summary}`);
      for (const write of target.writes) {
        console.log(`      ${write.columnName} <- "${write.value}"`);
      }
    }
  }
  if (plan.alreadyDone.length > 0) {
    console.log(`\n--- すでに反映済み(書き込み不要)`);
    for (const done of plan.alreadyDone) console.log(`  ${describe(done.row)}`);
  }
  // 黙って捨てると、報告された結果が記録されないまま作業が終わってしまう
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
  if (plan.errors.length > 0) {
    console.log(`\n--- 書き込めなかった指定`);
    for (const error of plan.errors) console.log(`  ${error.url}\n    ${error.message}`);
  }

  if (!apply) {
    console.log(`\n(--apply なしのためシートへの書き込みはしていない)`);
    return;
  }
  const writes = plan.targets.flatMap((target) => target.writes);
  if (writes.length === 0) {
    console.log(`\n書き込む対象がないため何もしなかった`);
    return;
  }
  await writeCells(client, spreadsheetId, sheetName, writes, raw.headerRow);
  console.log(`\n書き込み完了: ${plan.targets.length}行 / ${writes.length}セルを更新した`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

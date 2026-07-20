import "dotenv/config";
import { readFile } from "node:fs/promises";
import {
  createSheetsClient,
  fetchSheetData,
  getFirstSheetName,
  getSheetId,
  writeCells,
  deleteRows,
} from "../src/lib/sheetsClient.js";
import { parseSheetRows } from "../src/lib/sheetData.js";
import { normalizeCellText } from "../src/lib/textNormalize.js";
import { groupByCoreName, resolveDuplicateGroups, type CleanupDecision } from "../src/lib/companyDuplicates.js";
import { COLUMNS, type SheetRowData } from "../src/types.js";

const DECISIONS_PATH = "data/cleanup-decisions.json";

const NORMALIZED_COLUMNS: { columnName: string; field: keyof SheetRowData }[] = [
  { columnName: COLUMNS.companyName, field: "companyName" },
  { columnName: COLUMNS.companyUrl, field: "companyUrl" },
  { columnName: COLUMNS.formUrl, field: "formUrl" },
  { columnName: COLUMNS.note, field: "note" },
];

interface NormalizationDiff {
  rowIndex: number;
  columnName: string;
  before: string;
  after: string;
}

function computeNormalizationDiffs(rows: SheetRowData[]): NormalizationDiff[] {
  const diffs: NormalizationDiff[] = [];
  for (const row of rows) {
    for (const { columnName, field } of NORMALIZED_COLUMNS) {
      const before = row[field] as string;
      const after = normalizeCellText(before);
      if (after !== before) {
        diffs.push({ rowIndex: row.rowIndex, columnName, before, after });
      }
    }
  }
  return diffs;
}

async function loadDecisions(): Promise<CleanupDecision[]> {
  try {
    const content = await readFile(DECISIONS_PATH, "utf-8");
    return JSON.parse(content) as CleanupDecision[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return [];
    }
    console.warn(
      `\n${DECISIONS_PATH} の読み込みに失敗しました。判定内容は反映されません(全て要目視確認扱いになります): ${String(error)}`,
    );
    return [];
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) {
    throw new Error("環境変数 GOOGLE_SHEET_ID が設定されていません");
  }

  const client = await createSheetsClient();
  const sheetName = await getFirstSheetName(client, spreadsheetId);
  const raw = await fetchSheetData(client, spreadsheetId, sheetName);
  const rows = parseSheetRows(raw);

  const diffs = computeNormalizationDiffs(rows);

  // 重複グループ判定は正規化後の企業名で行う(表記ゆれ吸収のため)
  const normalizedRows = rows.map((row) => ({ ...row, companyName: normalizeCellText(row.companyName) }));
  const groups = groupByCoreName(normalizedRows);
  const decisions = await loadDecisions();
  const { resolved, unresolved } = resolveDuplicateGroups(groups, decisions);

  console.log(`=== 正規化対象セル: ${diffs.length}件 ===`);
  for (const diff of diffs) {
    console.log(`  [行${diff.rowIndex}] ${diff.columnName}: "${diff.before}" -> "${diff.after}"`);
  }

  console.log(`\n=== 統合対象グループ: ${resolved.length}件 ===`);
  for (const group of resolved) {
    console.log(
      `  [${group.coreName}] 残す行=${group.primary.rowIndex}(${group.primary.companyName}) ` +
        `削除行=${group.discarded.map((r) => `${r.rowIndex}(${r.companyName})`).join(", ")}`,
    );
  }

  console.log(`\n=== 要目視確認グループ: ${unresolved.length}件 ===`);
  for (const group of unresolved) {
    console.log(
      `  [${group.coreName}] 行=${group.rows.map((r) => `${r.rowIndex}(${r.companyName})`).join(", ")}`,
    );
    console.log(`    理由: ${group.reason}`);
  }

  if (!apply) {
    console.log(
      "\n(ドライランのため、実際の書き込み・削除は行っていません。内容を確認して --apply を付けて再実行してください)",
    );
    return;
  }

  if (diffs.length > 0) {
    try {
      await writeCells(
        client,
        spreadsheetId,
        sheetName,
        diffs.map((diff) => ({ rowIndex: diff.rowIndex, columnName: diff.columnName, value: diff.after })),
        raw.headerRow,
      );
      console.log(`\n正規化${diffs.length}件を書き込みました。`);
    } catch (error) {
      console.error(`\n正規化の書き込みに失敗しました(行削除は未実施です): ${String(error)}`);
      throw error;
    }
  }

  const discardedRowIndexes = resolved.flatMap((group) => group.discarded.map((row) => row.rowIndex));
  if (discardedRowIndexes.length > 0) {
    try {
      const sheetId = await getSheetId(client, spreadsheetId, sheetName);
      await deleteRows(client, spreadsheetId, sheetId, discardedRowIndexes);
      console.log(`削除${discardedRowIndexes.length}行を反映しました。`);
    } catch (error) {
      console.error(
        `\n行削除に失敗しました(正規化の書き込みは完了済みです。削除予定行: ${discardedRowIndexes.join(", ")}): ${String(error)}`,
      );
      throw error;
    }
  }

  console.log(`\n反映しました: 正規化${diffs.length}件、削除${discardedRowIndexes.length}行`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

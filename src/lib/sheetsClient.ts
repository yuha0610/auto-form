import { google, type sheets_v4 } from "googleapis";
import { columnIndexToLetter, findColumnIndex, findLastNonEmptyRow } from "./sheetData.js";
import type { RawSheetData } from "./sheetData.js";

export async function createSheetsClient(): Promise<sheets_v4.Sheets> {
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  if (!keyFile) {
    throw new Error("環境変数 GOOGLE_SERVICE_ACCOUNT_KEY_PATH が設定されていません");
  }
  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

export async function getFirstSheetName(
  client: sheets_v4.Sheets,
  spreadsheetId: string,
): Promise<string> {
  const res = await client.spreadsheets.get({ spreadsheetId });
  const title = res.data.sheets?.[0]?.properties?.title;
  if (!title) {
    throw new Error("スプレッドシートのシート名が取得できませんでした");
  }
  return title;
}

export async function fetchSheetData(
  client: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string,
): Promise<RawSheetData> {
  const res = await client.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A1:Z`,
  });
  const values = res.data.values ?? [];
  const [headerRow = [], ...dataRows] = values;
  return { headerRow, dataRows };
}

export async function writeCells(
  client: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string,
  writes: { rowIndex: number; columnName: string; value: string }[],
  headerRow: string[],
): Promise<void> {
  const data = writes.map((write) => {
    const colIndex = findColumnIndex(headerRow, write.columnName);
    const colLetter = columnIndexToLetter(colIndex);
    return {
      range: `${sheetName}!${colLetter}${write.rowIndex}`,
      values: [[write.value]],
    };
  });

  if (data.length === 0) return;

  await client.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data,
    },
  });
}

export async function getSheetId(
  client: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string,
): Promise<number> {
  const res = await client.spreadsheets.get({ spreadsheetId });
  const sheet = res.data.sheets?.find((s) => s.properties?.title === sheetName);
  const sheetId = sheet?.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) {
    throw new Error(`シートIDが取得できませんでした: ${sheetName}`);
  }
  return sheetId;
}

/** 指定した行番号(1始まり、ヘッダー行込み)を全て削除する。行番号が大きい順に削除し、インデックスのずれを防ぐ。 */
export async function deleteRows(
  client: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetId: number,
  rowIndexes: number[],
): Promise<void> {
  if (rowIndexes.length === 0) return;

  const sortedDescending = [...rowIndexes].sort((a, b) => b - a);
  const requests = sortedDescending.map((rowIndex) => ({
    deleteDimension: {
      range: {
        sheetId,
        dimension: "ROWS",
        startIndex: rowIndex - 1,
        endIndex: rowIndex,
      },
    },
  }));

  await client.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });
}

/** シート末尾に新規行を追加する(1行=1配列、複数行まとめて渡せる)。 */
export async function appendRows(
  client: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetName: string,
  rows: string[][],
): Promise<void> {
  if (rows.length === 0) return;

  // `values.append`は範囲の先頭セルが空だと「表が空」と判定して先頭に行を挿入し、
  // ヘッダー行ごと下にずらしてしまう(このシートはヘッダーのA列が空)。
  // 最終行を自分で求めて、その次の行に直接書き込む。
  const existing = await client.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A1:Z`,
  });
  const lastRow = findLastNonEmptyRow(existing.data.values ?? []);

  await client.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A${lastRow + 1}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: rows },
  });
}

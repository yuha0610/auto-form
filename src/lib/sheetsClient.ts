import { google, type sheets_v4 } from "googleapis";
import { columnIndexToLetter, findColumnIndex } from "./sheetData.js";
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

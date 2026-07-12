import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { Command } from "commander";
import { chromium, type Page } from "playwright";
import { loadTemplate } from "./lib/templates.js";
import { fillForm, injectFillBanner } from "./lib/formSubmitter.js";
import { findContactFormUrl } from "./lib/formDiscovery.js";
import { checkSubmissionOutcome } from "./lib/completionCheck.js";
import { selectBatch } from "./lib/targetSelection.js";
import { parseSheetRows } from "./lib/sheetData.js";
import {
  createSheetsClient,
  fetchSheetData,
  getFirstSheetName,
  writeCells,
} from "./lib/sheetsClient.js";
import { buildUpdates, type OutcomeUpdate } from "./lib/updates.js";
import {
  savePendingWrites,
  loadPendingWrites,
  deletePendingWrite,
} from "./lib/pendingWrites.js";
import type { EligibleTarget } from "./types.js";

const PENDING_WRITES_DIR = "data/pending-writes";

const program = new Command();

program
  .name("auto-form")
  .description("お問い合わせフォームへの自動営業ツール(Googleスプレッドシート連携版)")
  .option("-m, --template <path>", "文面テンプレートJSON", "data/templates/default.json")
  .option("-b, --batch-size <n>", "1回のバッチで開くタブ数", "20")
  .action(async (opts) => {
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    if (!spreadsheetId) {
      throw new Error("環境変数 GOOGLE_SHEET_ID が設定されていません");
    }

    const template = await loadTemplate(opts.template);
    const sheetsClient = await createSheetsClient();
    const sheetName = await getFirstSheetName(sheetsClient, spreadsheetId);

    const pending = await loadPendingWrites(PENDING_WRITES_DIR);
    if (pending.length > 0) {
      console.log(`前回書き込めなかった結果が${pending.length}件あります。再送します...`);
      for (const entry of pending) {
        try {
          const raw = await fetchSheetData(sheetsClient, spreadsheetId, sheetName);
          await writeCells(sheetsClient, spreadsheetId, sheetName, entry.writes, raw.headerRow);
          await deletePendingWrite(entry.path);
        } catch (error) {
          console.warn(`再送に失敗しました(${entry.path}): ${String(error)}`);
        }
      }
    }

    const raw = await fetchSheetData(sheetsClient, spreadsheetId, sheetName);
    const rows = parseSheetRows(raw);

    const batch = selectBatch(rows, Number(opts.batchSize), new Date());
    if (batch.length === 0) {
      console.log("送信対象の企業がありません。");
      return;
    }

    console.log(`${batch.length}件のタブを開きます...`);

    const browser = await chromium.launch({ headless: false });
    const opened: { target: EligibleTarget; page: Page; formUrl: string; discoveredUrl?: string }[] = [];

    for (const target of batch) {
      const page = await browser.newPage();
      let formUrl = target.row.formUrl;

      try {
        if (formUrl) {
          await page.goto(formUrl, { waitUntil: "domcontentloaded" });
        } else {
          await page.goto(target.row.companyUrl, { waitUntil: "domcontentloaded" });
          const discovered = await findContactFormUrl(page);
          if (!discovered) {
            console.warn(`[${target.row.companyName}] お問い合わせフォームが見つかりませんでした`);
            await page.close();
            continue;
          }
          await page.goto(discovered, { waitUntil: "domcontentloaded" });
          formUrl = discovered;
        }

        const { filledFields, missingFields } = await fillForm(page, template);
        await injectFillBanner(page, filledFields, missingFields);
        opened.push({ target, page, formUrl, discoveredUrl: target.row.formUrl ? undefined : formUrl });
      } catch (error) {
        console.warn(`[${target.row.companyName}] 読み込みに失敗: ${String(error)}`);
        await page.close();
      }
    }

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    await rl.question(
      `\n${opened.length}件のタブを開きました。確認・送信が終わったらEnterキーを押してください...`,
    );
    rl.close();

    const outcomeUpdates: OutcomeUpdate[] = [];
    for (const entry of opened) {
      const outcome = await checkSubmissionOutcome(entry.page, entry.formUrl);
      outcomeUpdates.push({
        rowIndex: entry.target.row.rowIndex,
        attemptNumber: entry.target.attemptNumber,
        outcome,
        existingNote: entry.target.row.note,
        formUrl: entry.discoveredUrl,
      });
      await entry.page.close();
    }

    await browser.close();

    const writes = outcomeUpdates.flatMap((update) => buildUpdates(update, new Date()));
    try {
      await writeCells(sheetsClient, spreadsheetId, sheetName, writes, raw.headerRow);
      console.log(`結果をスプレッドシートに記録しました(${outcomeUpdates.length}件)。`);
    } catch (error) {
      const path = await savePendingWrites(PENDING_WRITES_DIR, writes);
      console.warn(
        `スプレッドシートへの書き込みに失敗しました: ${String(error)}\n` +
          `結果は ${path} に保存しました。次回起動時に自動で再送されます。`,
      );
    }
  });

program.parseAsync();

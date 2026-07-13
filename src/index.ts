import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { Command } from "commander";
import { chromium, type Page } from "playwright";
import { loadTemplate } from "./lib/templates.js";
import { injectFillBanner } from "./lib/formSubmitter.js";
import { findContactFormUrl } from "./lib/formDiscovery.js";
import { fillFormWithDiscovery } from "./lib/formFillFlow.js";
import { checkSubmissionOutcome } from "./lib/completionCheck.js";
import { notifyBatchReady } from "./lib/notify.js";
import { countSentToday, notifySlackDailyCount } from "./lib/slackNotify.js";
import { selectBatch } from "./lib/targetSelection.js";
import { parseSheetRows } from "./lib/sheetData.js";
import {
  createSheetsClient,
  fetchSheetData,
  getFirstSheetName,
  writeCells,
} from "./lib/sheetsClient.js";
import { buildUpdates, type OutcomeUpdate } from "./lib/updates.js";
import { partitionByRowIntegrity } from "./lib/rowIntegrity.js";
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

    const candidates = selectBatch(rows, rows.length, new Date());
    if (candidates.length === 0) {
      console.log("送信対象の企業がありません。");
      return;
    }

    const desiredBatchSize = Number(opts.batchSize);
    console.log(`最大${desiredBatchSize}件のタブを開きます...`);

    const browser = await chromium.launch({ headless: false });
    try {
      const opened: { target: EligibleTarget; page: Page; formUrl: string; discoveredUrl?: string }[] = [];
      const outcomeUpdates: OutcomeUpdate[] = [];
      const expectedCompanyName = new Map<number, string>();

      for (const target of candidates) {
        if (opened.length >= desiredBatchSize) break;

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
              outcomeUpdates.push({
                rowIndex: target.row.rowIndex,
                attemptNumber: target.attemptNumber,
                outcome: "failed",
                existingNote: target.row.note,
                failureReason: "フォーム無(要確認)",
              });
              expectedCompanyName.set(target.row.rowIndex, target.row.companyName);
              await page.close();
              continue;
            }
            await page.goto(discovered, { waitUntil: "domcontentloaded" });
            formUrl = discovered;
          }

          const { filledFields, missingFields, navigatedTo } = await fillFormWithDiscovery(page, template);
          await injectFillBanner(page, filledFields, missingFields);
          if (navigatedTo) formUrl = navigatedTo;
          opened.push({ target, page, formUrl, discoveredUrl: target.row.formUrl ? undefined : formUrl });
        } catch (error) {
          console.warn(`[${target.row.companyName}] 読み込みに失敗: ${String(error)}`);
          outcomeUpdates.push({
            rowIndex: target.row.rowIndex,
            attemptNumber: target.attemptNumber,
            outcome: "failed",
            existingNote: target.row.note,
            failureReason: "読み込み失敗(要確認)",
          });
          expectedCompanyName.set(target.row.rowIndex, target.row.companyName);
          await page.close();
        }
      }

      if (opened.length > 0) {
        await notifyBatchReady(opened.length);
      }

      const rl = createInterface({ input: process.stdin, output: process.stdout });
      await rl.question(
        `\n${opened.length}件のタブを開きました。確認・送信が終わったらEnterキーを押してください...`,
      );
      rl.close();

      for (const entry of opened) {
        try {
          const outcome = await checkSubmissionOutcome(entry.page, entry.formUrl);
          outcomeUpdates.push({
            rowIndex: entry.target.row.rowIndex,
            attemptNumber: entry.target.attemptNumber,
            outcome,
            existingNote: entry.target.row.note,
            formUrl: entry.discoveredUrl,
          });
          expectedCompanyName.set(entry.target.row.rowIndex, entry.target.row.companyName);
        } catch (error) {
          console.warn(`[${entry.target.row.companyName}] 送信結果の確認に失敗しました: ${String(error)}`);
          outcomeUpdates.push({
            rowIndex: entry.target.row.rowIndex,
            attemptNumber: entry.target.attemptNumber,
            outcome: "uncertain",
            existingNote: entry.target.row.note,
            formUrl: entry.discoveredUrl,
          });
          expectedCompanyName.set(entry.target.row.rowIndex, entry.target.row.companyName);
        } finally {
          await entry.page.close().catch(() => {});
        }
      }

      const freshRaw = await fetchSheetData(sheetsClient, spreadsheetId, sheetName);
      const freshRows = parseSheetRows(freshRaw);
      const actualCompanyName = new Map(freshRows.map((r) => [r.rowIndex, r.companyName]));

      const { valid, mismatched } = partitionByRowIntegrity(
        outcomeUpdates,
        expectedCompanyName,
        actualCompanyName,
      );

      if (mismatched.length > 0) {
        for (const { item, expected, actual } of mismatched) {
          console.warn(
            `[行${item.rowIndex}] 書き込みをスキップしました: 期待した企業名「${expected ?? "(不明)"}」に対し` +
              `現在の行の企業名は「${actual ?? "(行が見つかりません)"}」でした。` +
              `バッチ実行中にスプレッドシートが編集(ソート・行の追加削除など)された可能性があるため、` +
              `この結果は安全に書き込めません。`,
          );
        }
      }

      const writes = valid.flatMap((update) => buildUpdates(update, new Date()));
      try {
        await writeCells(sheetsClient, spreadsheetId, sheetName, writes, freshRaw.headerRow);
        if (mismatched.length > 0) {
          console.log(
            `結果をスプレッドシートに記録しました(${valid.length}件、` +
              `行ズレのため${mismatched.length}件はスキップしました)。`,
          );
        } else {
          console.log(`結果をスプレッドシートに記録しました(${valid.length}件)。`);
        }
      } catch (error) {
        const path = await savePendingWrites(PENDING_WRITES_DIR, writes);
        console.warn(
          `スプレッドシートへの書き込みに失敗しました: ${String(error)}\n` +
            `結果は ${path} に保存しました。次回起動時に自動で再送されます。`,
        );
      }

      try {
        const countRaw = await fetchSheetData(sheetsClient, spreadsheetId, sheetName);
        const countRows = parseSheetRows(countRaw);
        await notifySlackDailyCount(countSentToday(countRows, new Date()));
      } catch (error) {
        console.warn(`今日の送信件数の集計に失敗しました: ${String(error)}`);
      }
    } finally {
      await browser.close();
    }
  });

program.parseAsync();

import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { Command } from "commander";
import { chromium, type Page } from "playwright";
import { loadTemplate, renderTemplate } from "./lib/templates.js";
import { injectFillBanner } from "./lib/formSubmitter.js";
import { findContactFormUrl, extractMailto } from "./lib/formDiscovery.js";
import { fillFormWithDiscovery } from "./lib/formFillFlow.js";
import { gotoWithRetry, NavigationError } from "./lib/navigation.js";
import { checkSubmissionOutcome } from "./lib/completionCheck.js";
import { appendMissedFieldsLog } from "./lib/missedFieldsLog.js";
import { appendUncertainLog } from "./lib/uncertainLog.js";
import { notifyBatchReady } from "./lib/notify.js";
import { countSentToday, notifySlackDailyCount, notifySlackText } from "./lib/slackNotify.js";
import {
  fetchGoal,
  countSentActions,
  countRemainingBusinessDays,
  countSentThisWeek,
  countBusinessDaysInclusive,
  getWeekStart,
  buildProgressMessage,
  countSentThisMonth,
  countDealsWon,
  writeProgressCounts,
} from "./lib/progressGoal.js";
import {
  selectBatch,
  selectFormMissingRetryTargets,
  dedupeByCompanyName,
  summarizeSkipped,
} from "./lib/targetSelection.js";
import { parseSheetRows } from "./lib/sheetData.js";
import {
  createSheetsClient,
  fetchSheetData,
  getFirstSheetName,
  writeCells,
} from "./lib/sheetsClient.js";
import { buildUpdates, type OutcomeUpdate } from "./lib/updates.js";
import { matchPastedUrls } from "./lib/urlMatch.js";
import { parseAnswerNumber } from "./lib/answers.js";
import { partitionByRowIntegrity } from "./lib/rowIntegrity.js";
import {
  savePendingWrites,
  loadPendingWrites,
  deletePendingWrite,
} from "./lib/pendingWrites.js";
import type { EligibleTarget } from "./types.js";

const PENDING_WRITES_DIR = "data/pending-writes";
const MISSED_FIELDS_LOG_PATH = "data/missed-fields-log.jsonl";
const UNCERTAIN_LOG_PATH = "data/uncertain-outcomes-log.jsonl";

const program = new Command();

program
  .name("auto-form")
  .description("お問い合わせフォームへの自動営業ツール(Googleスプレッドシート連携版)")
  .option("-m, --template <path>", "文面テンプレートJSON", "data/templates/default.json")
  .option("-b, --batch-size <n>", "1回のバッチで開くタブ数", "20")
  .option("--skip-report", "スキップ理由ごとに件数・企業名を集計して表示する(送信は行わない)")
  .option(
    "--retry-form-missing",
    "備考が「フォーム無」の企業の企業HPを開き、手動でフォームを探して送信する",
  )
  .action(async (opts) => {
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    if (!spreadsheetId) {
      throw new Error("環境変数 GOOGLE_SHEET_ID が設定されていません");
    }

    const sheetsClient = await createSheetsClient();
    const sheetName = await getFirstSheetName(sheetsClient, spreadsheetId);

    if (opts.skipReport) {
      const raw = await fetchSheetData(sheetsClient, spreadsheetId, sheetName);
      const rows = parseSheetRows(raw);
      const summary = summarizeSkipped(rows);
      if (summary.length === 0) {
        console.log("スキップされた企業はありません。");
      } else {
        for (const { reason, companies } of summary) {
          console.log(`\n${reason}: ${companies.length}件`);
          for (const name of companies) console.log(`  - ${name}`);
        }
      }
      return;
    }

    const template = await loadTemplate(opts.template);

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
    const dedupedRows = dedupeByCompanyName(rows);
    if (dedupedRows.length < rows.length) {
      console.log(
        `企業名が重複する行を${rows.length - dedupedRows.length}件検出したため、` +
          `送信が最も進んでいる行のみを対象にします(二重送信防止)。`,
      );
    }

    const isFormMissingRetry = Boolean(opts.retryFormMissing);
    const candidates = isFormMissingRetry
      ? selectFormMissingRetryTargets(dedupedRows, new Date())
      : selectBatch(dedupedRows, dedupedRows.length, new Date());
    if (candidates.length === 0) {
      console.log(
        isFormMissingRetry
          ? "「フォーム無」の企業がありません。"
          : "送信対象の企業がありません。",
      );
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
          if (isFormMissingRetry) {
            await gotoWithRetry(page, target.row.companyUrl, { waitUntil: "domcontentloaded" });
            opened.push({ target, page, formUrl: target.row.companyUrl });
            continue;
          }

          if (formUrl) {
            await gotoWithRetry(page, formUrl, { waitUntil: "domcontentloaded" });
          } else {
            await gotoWithRetry(page, target.row.companyUrl, { waitUntil: "domcontentloaded" });
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

            const email = extractMailto(discovered);
            if (email) {
              console.warn(`[${target.row.companyName}] お問い合わせ先がメールアドレスでした: ${email}`);
              outcomeUpdates.push({
                rowIndex: target.row.rowIndex,
                attemptNumber: target.attemptNumber,
                outcome: "email",
                existingNote: target.row.note,
                email,
              });
              expectedCompanyName.set(target.row.rowIndex, target.row.companyName);
              await page.close();
              continue;
            }

            await gotoWithRetry(page, discovered, { waitUntil: "domcontentloaded" });
            formUrl = discovered;
          }

          const personalizedTemplate = renderTemplate(template, target.row.companyName);
          const { filledFields, missingFields, fieldCandidates, navigatedTo } =
            await fillFormWithDiscovery(page, personalizedTemplate);
          await injectFillBanner(page, filledFields, missingFields);
          if (navigatedTo) formUrl = navigatedTo;
          if (missingFields.length > 0) {
            try {
              await appendMissedFieldsLog(MISSED_FIELDS_LOG_PATH, {
                timestamp: new Date().toISOString(),
                companyName: target.row.companyName,
                url: navigatedTo ?? formUrl,
                missingFields,
                fieldCandidates,
              });
            } catch (error) {
              console.warn(`missed-fields-logの書き込みに失敗しました: ${String(error)}`);
            }
          }
          opened.push({ target, page, formUrl, discoveredUrl: target.row.formUrl ? undefined : formUrl });
        } catch (error) {
          const failureReason =
            error instanceof NavigationError ? error.label : "読み込み失敗(要確認)";
          console.warn(`[${target.row.companyName}] 読み込みに失敗: ${String(error)}`);
          outcomeUpdates.push({
            rowIndex: target.row.rowIndex,
            attemptNumber: target.attemptNumber,
            outcome: "failed",
            existingNote: target.row.note,
            failureReason,
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

      // どちらのモードもURLを貼るだけで済むようにする(企業名を覚えておく必要をなくす)。
      // 通常モードは「送信できなかった」方を、企業HPから手動で探すモードは
      // 「送信できた」方を貼ってもらう(そちらが少数派なので入力が少ない)。
      const pastedUrlByIndex = new Map<number, string>();
      if (opened.length > 0) {
        console.log("\n開いた企業一覧:");
        opened.forEach((entry, i) =>
          console.log(`  ${i + 1}. ${entry.target.row.companyName}\n     ${entry.formUrl}`),
        );
        const answer = await rl.question(
          isFormMissingRetry
            ? "\n送信できた企業のURLを貼ってください(そのままフォームURLとして保存します。複数はカンマ/改行区切り、なければEnter): "
            : "\n送信できなかった企業のURLを貼ってください(複数はカンマ/改行区切り、なければそのままEnter): ",
        );
        const { matches, unmatched } = matchPastedUrls(
          answer,
          opened.map((entry, i) => ({
            key: i,
            urls: [entry.formUrl, entry.target.row.companyUrl].filter((url) => url),
          })),
        );
        matches.forEach((pairing) => pastedUrlByIndex.set(pairing.key, pairing.url));

        // 外部のフォームサービスを使っている企業だとドメインが違って紐付けられない。
        // 黙って捨てると作業が無駄になるので、番号で対応先を聞く。
        for (const url of unmatched) {
          console.log(`\nこのURLがどの企業か判別できませんでした: ${url}`);
          const which = await rl.question("  対応する企業の番号を入力してください(不要ならEnter): ");
          const n = parseAnswerNumber(which);
          if (n !== null && n >= 1 && n <= opened.length) {
            pastedUrlByIndex.set(n - 1, url);
            console.log(`  -> ${opened[n - 1].target.row.companyName} として記録します`);
          } else {
            console.log("  -> このURLは記録しません");
          }
        }
      }

      let skippedInRetry = 0;
      for (const [index, entry] of opened.entries()) {
        const pastedUrl = pastedUrlByIndex.get(index);

        // 企業HPから手動でフォームを探すモードでは、完了文言の有無で判定すると
        // 「フォームが見つからず何も送っていない」場合まで送信済み扱い(uncertainでも
        // 送信日が入る)になってしまう。貼られたURLだけを送信済みの根拠にする。
        if (isFormMissingRetry) {
          if (!pastedUrl) {
            skippedInRetry++;
            await entry.page.close().catch(() => {});
            continue;
          }
          outcomeUpdates.push({
            rowIndex: entry.target.row.rowIndex,
            attemptNumber: entry.target.attemptNumber,
            outcome: "success",
            existingNote: entry.target.row.note,
            formUrl: pastedUrl,
          });
          expectedCompanyName.set(entry.target.row.rowIndex, entry.target.row.companyName);
          await entry.page.close().catch(() => {});
          continue;
        }

        if (pastedUrl) {
          outcomeUpdates.push({
            rowIndex: entry.target.row.rowIndex,
            attemptNumber: entry.target.attemptNumber,
            outcome: "failed",
            existingNote: entry.target.row.note,
            failureReason: "送信失敗",
          });
          expectedCompanyName.set(entry.target.row.rowIndex, entry.target.row.companyName);
          await entry.page.close().catch(() => {});
          continue;
        }

        try {
          const { outcome, failureReason, bodyExcerpt } = await checkSubmissionOutcome(
            entry.page,
            entry.formUrl,
          );
          if (outcome === "uncertain" && bodyExcerpt !== undefined) {
            try {
              await appendUncertainLog(UNCERTAIN_LOG_PATH, {
                timestamp: new Date().toISOString(),
                companyName: entry.target.row.companyName,
                url: entry.page.url(),
                bodyExcerpt,
              });
            } catch (error) {
              console.warn(`uncertain-outcomes-logの書き込みに失敗しました: ${String(error)}`);
            }
          }
          outcomeUpdates.push({
            rowIndex: entry.target.row.rowIndex,
            attemptNumber: entry.target.attemptNumber,
            outcome,
            existingNote: entry.target.row.note,
            formUrl: entry.discoveredUrl,
            failureReason,
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

      rl.close();

      if (skippedInRetry > 0) {
        console.log(`\n未送信のため記録しなかった企業: ${skippedInRetry}件`);
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

        const goal = await fetchGoal(sheetsClient, spreadsheetId);
        if (goal) {
          const today = new Date();
          const totalSent = countSentActions(countRows);
          const remainingBusinessDays = countRemainingBusinessDays(today, goal.deadline);

          const weekStart = getWeekStart(today);
          const weekEnd = new Date(weekStart);
          weekEnd.setDate(weekEnd.getDate() + 6);
          const thisWeekSent = countSentThisWeek(countRows, weekStart, today);
          const tomorrow = new Date(today);
          tomorrow.setDate(tomorrow.getDate() + 1);
          const thisWeekRemainingBusinessDays = countBusinessDaysInclusive(tomorrow, weekEnd);

          const thisMonthSent = countSentThisMonth(countRows, today);
          const dealsWon = countDealsWon(countRows);
          await writeProgressCounts(sheetsClient, spreadsheetId, dealsWon, thisMonthSent, today);

          await notifySlackText(
            buildProgressMessage(
              totalSent,
              goal,
              remainingBusinessDays,
              thisWeekSent,
              thisWeekRemainingBusinessDays,
              weekStart,
            ),
          );
        }
      } catch (error) {
        console.warn(`今日の送信件数・進捗の集計に失敗しました: ${String(error)}`);
      }
    } finally {
      await browser.close();
    }
  });

program.parseAsync();

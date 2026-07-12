import { Command } from "commander";
import { chromium } from "playwright";
import { loadTargets, saveTargets } from "./lib/targets.js";
import { loadTemplate } from "./lib/templates.js";
import { fillForm } from "./lib/formSubmitter.js";
import { appendResult } from "./lib/results.js";
import type { SubmissionResult } from "./types.js";

const program = new Command();

program
  .name("auto-form")
  .description("お問い合わせフォームへの自動営業ツール")
  .option("-t, --targets <path>", "対象リストCSV", "data/targets.csv")
  .option("-m, --template <path>", "文面テンプレートJSON", "data/templates/default.json")
  .option("-r, --results <path>", "結果ログCSVの出力先", "data/results.csv")
  .option("--submit", "入力後に送信ボタンまで自動でクリックする（既定は入力のみ）", false)
  .option("--headed", "ブラウザ画面を表示して実行する", false)
  .action(async (opts) => {
    const targets = await loadTargets(opts.targets);
    const template = await loadTemplate(opts.template);

    const browser = await chromium.launch({ headless: !opts.headed });

    for (const target of targets) {
      if (target.status !== "pending") continue;

      const page = await browser.newPage();
      let result: SubmissionResult;

      try {
        await page.goto(target.url, { waitUntil: "domcontentloaded" });
        const { filledFields, missingFields } = await fillForm(page, template);

        if (missingFields.length > 0) {
          console.warn(`[${target.company}] 未検出フィールド: ${missingFields.join(", ")}`);
        }

        if (opts.submit) {
          const submitButton = page.getByRole("button", { name: /送信|submit/i }).first();
          await submitButton.click();
          target.status = "success";
          result = {
            company: target.company,
            url: target.url,
            status: "success",
            detail: `入力済み: ${filledFields.join(",")} / 送信済み`,
            timestamp: new Date().toISOString(),
          };
        } else {
          target.status = "skipped";
          result = {
            company: target.company,
            url: target.url,
            status: "skipped",
            detail: `入力のみ完了（--submit未指定）: ${filledFields.join(",")}`,
            timestamp: new Date().toISOString(),
          };
        }
      } catch (error) {
        target.status = "failed";
        result = {
          company: target.company,
          url: target.url,
          status: "failed",
          detail: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString(),
        };
      } finally {
        await page.close();
      }

      await appendResult(opts.results, result);
      console.log(`[${result.status}] ${target.company} (${target.url})`);
    }

    await browser.close();
    await saveTargets(opts.targets, targets);
  });

program.parseAsync();

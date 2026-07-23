import { test, expect } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatMissedFieldsLogLine, appendMissedFieldsLog } from "../src/lib/missedFieldsLog.js";

const entry = {
  timestamp: "2026-07-23T00:00:00.000Z",
  companyName: "テスト株式会社",
  url: "https://example.test/contact",
  missingFields: ["senderPhone"],
  fieldCandidates: [{ name: "tel", placeholder: "", label: "お電話番号" }],
};

test("formatMissedFieldsLogLine: エントリを改行付きの1行のJSONにする", () => {
  const line = formatMissedFieldsLogLine(entry);

  expect(line.endsWith("\n")).toBe(true);
  expect(JSON.parse(line)).toEqual(entry);
});

test("appendMissedFieldsLog: ディレクトリが無くても作成し、JSON Linesとして追記していく", async () => {
  const dir = await mkdtemp(join(tmpdir(), "auto-form-missed-fields-"));
  const path = join(dir, "nested", "missed-fields-log.jsonl");
  try {
    await appendMissedFieldsLog(path, entry);
    await appendMissedFieldsLog(path, { ...entry, companyName: "別の会社" });

    const content = await readFile(path, "utf-8");
    const lines = content.trim().split("\n").map((line) => JSON.parse(line));

    expect(lines).toEqual([entry, { ...entry, companyName: "別の会社" }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

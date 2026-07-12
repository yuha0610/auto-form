import { access, appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { stringify } from "csv-stringify/sync";
import type { SubmissionResult } from "../types.js";

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function appendResult(path: string, result: SubmissionResult): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const includeHeader = !(await fileExists(path));
  const csv = stringify([result], {
    header: includeHeader,
    columns: ["company", "url", "status", "detail", "timestamp"],
  });
  await appendFile(path, csv, "utf-8");
}

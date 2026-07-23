import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { FieldCandidateInfo } from "./formSubmitter.js";

export interface MissedFieldsLogEntry {
  timestamp: string;
  companyName: string;
  url: string;
  missingFields: string[];
  fieldCandidates: FieldCandidateInfo[];
}

/** FIELD_KEYWORDS拡張の材料にするため、missingFieldsの手がかりをJSON Lines形式の1行にする。 */
export function formatMissedFieldsLogLine(entry: MissedFieldsLogEntry): string {
  return `${JSON.stringify(entry)}\n`;
}

export async function appendMissedFieldsLog(
  path: string,
  entry: MissedFieldsLogEntry,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, formatMissedFieldsLogLine(entry), "utf-8");
}

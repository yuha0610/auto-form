import { readFile, writeFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import type { Target } from "../types.js";

export async function loadTargets(path: string): Promise<Target[]> {
  const raw = await readFile(path, "utf-8");
  const rows = parse(raw, { columns: true, skip_empty_lines: true }) as Target[];
  return rows;
}

export async function saveTargets(path: string, targets: Target[]): Promise<void> {
  const csv = stringify(targets, {
    header: true,
    columns: ["company", "url", "status", "note"],
  });
  await writeFile(path, csv, "utf-8");
}

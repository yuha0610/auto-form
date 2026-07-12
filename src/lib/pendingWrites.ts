import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CellWrite } from "./updates.js";

export async function savePendingWrites(dir: string, writes: CellWrite[]): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, `pending-${Date.now()}.json`);
  await writeFile(path, JSON.stringify(writes, null, 2), "utf-8");
  return path;
}

export async function loadPendingWrites(
  dir: string,
): Promise<{ path: string; writes: CellWrite[] }[]> {
  await mkdir(dir, { recursive: true });
  const files = (await readdir(dir)).filter((file) => file.endsWith(".json"));
  const results: { path: string; writes: CellWrite[] }[] = [];
  for (const file of files) {
    const path = join(dir, file);
    const content = await readFile(path, "utf-8");
    try {
      results.push({ path, writes: JSON.parse(content) as CellWrite[] });
    } catch (error) {
      console.warn(`Failed to parse pending-write file: ${path}`, error);
    }
  }
  return results;
}

export async function deletePendingWrite(path: string): Promise<void> {
  await rm(path, { force: true });
}

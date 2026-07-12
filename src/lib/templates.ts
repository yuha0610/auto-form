import { readFile } from "node:fs/promises";
import type { Template } from "../types.js";

export async function loadTemplate(path: string): Promise<Template> {
  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw) as Template;
}

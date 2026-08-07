import { readFile } from "node:fs/promises";
import type { Template } from "../types.js";

export async function loadTemplate(path: string): Promise<Template> {
  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw) as Template;
}

export function renderTemplate(template: Template, companyName: string): Template {
  const trimmed = companyName.trim();
  const value = trimmed ? `${trimmed}様` : "貴社";
  const replace = (text: string) => text.split("{{companyName}}").join(value);
  return { ...template, subject: replace(template.subject), message: replace(template.message) };
}

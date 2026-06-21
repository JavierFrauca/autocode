import { app } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";

function resolvePromptsDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "prompts");
  }
  return path.resolve(__dirname, "../../prompts");
}

function resolveCustomPromptsDir(): string {
  return path.join(app.getPath("userData"), "prompts-custom");
}

// Lazy: NO resolver los directorios al cargar el módulo. `electron.app` no existe hasta que la app
// arranca (ni en tests bajo node), así que tocarlo en el top-level rompería cualquier importador.
function promptsDir(): string {
  return resolvePromptsDir();
}
function customPromptsDir(): string {
  return resolveCustomPromptsDir();
}

function stripFrontMatter(raw: string): string {
  return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trimStart();
}

/**
 * Load a prompt. Checks user override first, falls back to bundled prompt.
 * File is re-read on every call so edits take effect without restart.
 */
export async function loadPrompt(name: string): Promise<string> {
  const customFile = path.join(customPromptsDir(), `${name}.md`);
  try {
    const raw = await fs.readFile(customFile, "utf8");
    return stripFrontMatter(raw);
  } catch {}
  const file = path.join(promptsDir(), `${name}.md`);
  const raw = await fs.readFile(file, "utf8");
  return stripFrontMatter(raw);
}

/** List all available prompts and whether each has a user override. */
export async function listPrompts(): Promise<{ name: string; isCustom: boolean }[]> {
  const entries = await fs.readdir(promptsDir(), { withFileTypes: true });
  const names = entries
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => path.basename(e.name, ".md"))
    .sort();

  const customNames = new Set<string>();
  try {
    const custom = await fs.readdir(customPromptsDir(), { withFileTypes: true });
    custom.filter((e) => e.isFile() && e.name.endsWith(".md"))
      .forEach((e) => customNames.add(path.basename(e.name, ".md")));
  } catch {}

  return names.map((name) => ({ name, isCustom: customNames.has(name) }));
}

/**
 * Get the full raw content of a prompt (with front-matter).
 * Returns active content (custom if exists), plus the bundled default for diffing/reset.
 */
export async function getPromptRaw(name: string): Promise<{ content: string; isCustom: boolean; defaultContent: string }> {
  const defaultFile = path.join(promptsDir(), `${name}.md`);
  const defaultContent = await fs.readFile(defaultFile, "utf8").catch(() => "");

  const customFile = path.join(customPromptsDir(), `${name}.md`);
  try {
    const content = await fs.readFile(customFile, "utf8");
    return { content, isCustom: true, defaultContent };
  } catch {
    return { content: defaultContent, isCustom: false, defaultContent };
  }
}

/** Save a user override for a prompt. */
export async function savePromptOverride(name: string, content: string): Promise<void> {
  const dir = customPromptsDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${name}.md`), content, "utf8");
}

/** Delete the user override, restoring the bundled default. */
export async function resetPromptOverride(name: string): Promise<void> {
  try { await fs.unlink(path.join(customPromptsDir(), `${name}.md`)); } catch {}
}

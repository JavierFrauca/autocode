import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { ulid } from "ulid";

export interface ParsedPaper {
  id: string;
  title: string;
  tags: string[];
  status: "draft" | "active" | "deprecated";
  body: string;
  raw: string;
}

export function buildPaper(p: ParsedPaper): string {
  const fm = {
    id: p.id,
    title: p.title,
    tags: p.tags,
    status: p.status,
    updated_at: new Date().toISOString(),
  };
  return matter.stringify(p.body.trimStart(), fm);
}

export function parsePaper(raw: string): ParsedPaper | null {
  try {
    const { data, content } = matter(raw);
    if (!data.id || !data.title) return null;
    return {
      id: String(data.id),
      title: String(data.title),
      tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
      status: (["draft", "active", "deprecated"] as const).includes(data.status)
        ? data.status
        : "draft",
      body: content,
      raw,
    };
  } catch {
    return null;
  }
}

export async function ensureDir(p: string): Promise<void> {
  await fs.mkdir(p, { recursive: true });
}

export async function readPaper(rootPath: string, relPath: string): Promise<ParsedPaper | null> {
  const abs = path.join(rootPath, relPath);
  try {
    const raw = await fs.readFile(abs, "utf8");
    return parsePaper(raw);
  } catch {
    return null;
  }
}

export async function writePaper(rootPath: string, relPath: string, paper: ParsedPaper): Promise<void> {
  const abs = path.join(rootPath, relPath);
  await ensureDir(path.dirname(abs));
  await fs.writeFile(abs, buildPaper(paper), "utf8");
}

export async function deletePaper(rootPath: string, relPath: string): Promise<void> {
  try {
    await fs.unlink(path.join(rootPath, relPath));
  } catch {}
}

export async function walkPapers(rootPath: string): Promise<{ path: string; paper: ParsedPaper }[]> {
  const out: { path: string; paper: ParsedPaper }[] = [];
  async function walk(dir: string, rel: string) {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith("_autocode") || e.name === "build" || e.name === "node_modules") continue;
      const full = path.join(dir, e.name);
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await walk(full, relPath);
      } else if (e.name.endsWith(".md")) {
        const raw = await fs.readFile(full, "utf8").catch(() => null);
        if (!raw) continue;
        const paper = parsePaper(raw);
        if (paper) out.push({ path: relPath, paper });
      }
    }
  }
  await walk(rootPath, "");
  return out;
}

export function newPaperId(): string {
  return `doc_${ulid().toLowerCase()}`;
}

export function safeRelPath(p: string): string {
  return p.replaceAll("\\", "/").replace(/^\/+/, "");
}

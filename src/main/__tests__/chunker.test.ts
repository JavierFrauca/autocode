import { describe, expect, it } from "vitest";
import { chunkMarkdown } from "../papers/ingest.js";

describe("chunkMarkdown", () => {
  it("splits by headings preserving headingPath", () => {
    const body = `# Title
intro text

## Section A
content A line 1
content A line 2

## Section B
content B`;
    const chunks = chunkMarkdown(body);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks.find((c) => c.headingPath === "Section A")).toBeTruthy();
    expect(chunks.find((c) => c.headingPath === "Section B")).toBeTruthy();
  });

  it("splits long sections into overlapping chunks", () => {
    const body = `## Big\n${"x".repeat(3000)}`;
    const chunks = chunkMarkdown(body);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.headingPath).toBe("Big");
  });

  it("returns empty when body is empty", () => {
    expect(chunkMarkdown("")).toEqual([]);
    expect(chunkMarkdown("\n\n   \n")).toEqual([]);
  });
});

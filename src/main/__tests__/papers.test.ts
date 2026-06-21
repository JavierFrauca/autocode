import { describe, expect, it } from "vitest";
import { buildPaper, parsePaper } from "../papers/fs.js";

describe("paper round-trip", () => {
  it("writes and re-reads a paper preserving front-matter", () => {
    const raw = buildPaper({
      id: "doc_test",
      title: "Hola",
      tags: ["a", "b"],
      status: "active",
      body: "# Hola\n\nContenido.\n",
      raw: "",
    });
    const parsed = parsePaper(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.id).toBe("doc_test");
    expect(parsed!.title).toBe("Hola");
    expect(parsed!.tags).toEqual(["a", "b"]);
    expect(parsed!.status).toBe("active");
    expect(parsed!.body).toContain("Contenido");
  });

  it("returns null for malformed papers", () => {
    expect(parsePaper("no front matter here")).toBeNull();
    expect(parsePaper("---\nnotitle: x\n---\nbody")).toBeNull();
  });
});

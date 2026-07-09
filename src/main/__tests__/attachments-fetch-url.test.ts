import { afterEach, describe, expect, test, vi } from "vitest";
import { fetchUrlAsMarkdown } from "../attachments.js";

/**
 * `fetchUrlAsMarkdown` es sensible a seguridad (SSRF, tamaño) y a que el tipo REAL de contenido decida
 * el lector — por eso se mockea `fetch` en vez de tocar la red. Cubre solo lo que puede fallar en
 * silencio: el guardrail y el enrutado por content-type/extensión (no la conversión HTML→Markdown en
 * detalle, que ya depende de `turndown`).
 */

function mockResponse(opts: { ok?: boolean; status?: number; headers?: Record<string, string>; body: Buffer | string }) {
  const buf = Buffer.isBuffer(opts.body) ? opts.body : Buffer.from(opts.body, "utf-8");
  const headers = new Map(Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchUrlAsMarkdown — guardrails", () => {
  test("rechaza direcciones no http/https", async () => {
    await expect(fetchUrlAsMarkdown("ftp://example.com/x")).rejects.toThrow(/http\/https/);
  });

  test("rechaza URLs mal formadas", async () => {
    await expect(fetchUrlAsMarkdown("no es una url")).rejects.toThrow(/no es válida/);
  });

  test("rechaza direcciones privadas/locales (SSRF)", async () => {
    for (const host of ["http://localhost/x", "http://127.0.0.1/x", "http://192.168.1.5/x", "http://10.0.0.1/x"]) {
      await expect(fetchUrlAsMarkdown(host)).rejects.toThrow(/locales o privadas/);
    }
  });

  test("rechaza descargas que declaran superar el límite de tamaño", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      mockResponse({ headers: { "content-length": String(51 * 1024 * 1024) }, body: "x" }),
    ));
    await expect(fetchUrlAsMarkdown("https://example.com/enorme.pdf")).rejects.toThrow(/demasiado grande/);
  });

  test("propaga un error claro si el servidor responde con fallo", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse({ ok: false, status: 404, body: "" })));
    await expect(fetchUrlAsMarkdown("https://example.com/no-existe")).rejects.toThrow(/404/);
  });
});

describe("fetchUrlAsMarkdown — enruta por el tipo REAL, no siempre por HTML", () => {
  test("una URL .xsd se procesa como documento estructurado, no como HTML", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      mockResponse({ headers: { "content-type": "application/xml" }, body: "<xs:schema/>" }),
    ));
    const r = await fetchUrlAsMarkdown("https://example.org/specs/facturae.xsd");
    expect(r.markdown).toContain("```xsd");
    expect(r.markdown).toContain("<xs:schema/>");
    expect(r.title).toBe("facturae.xsd");
  });

  test("un .pdf servido sin extensión en la URL se detecta por content-type", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      mockResponse({ headers: { "content-type": "application/pdf; charset=binary" }, body: "%PDF-1.4 sin texto real" }),
    ));
    const r = await fetchUrlAsMarkdown("https://example.org/download?id=123");
    // El PDF de prueba no es un PDF real y pdf-parse fallará al parsear: el mensaje de fallo controlado
    // (no una excepción) confirma que se entró por la vía de extractText, no por Turndown/HTML.
    expect(r.markdown).toMatch(/no se pudo leer el PDF|PDF sin texto extraíble/);
  });

  test("una página normal sigue yendo por HTML → Markdown", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse({
      headers: { "content-type": "text/html; charset=utf-8" },
      body: "<html><head><title>Mi página</title></head><body><h1>Hola</h1><p>Texto.</p></body></html>",
    })));
    const r = await fetchUrlAsMarkdown("https://example.org/articulo");
    expect(r.title).toBe("Mi página");
    expect(r.markdown).toContain("Hola");
    expect(r.markdown).toContain("Texto.");
  });

  test("un .zip se descomprime y procesa por dentro (no se trata como HTML)", async () => {
    const AdmZip = (await import("adm-zip")).default;
    const zip = new AdmZip();
    zip.addFile("mensaje.xsd", Buffer.from("<xs:schema/>"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      mockResponse({ headers: { "content-type": "application/zip" }, body: zip.toBuffer() }),
    ));
    const r = await fetchUrlAsMarkdown("https://example.org/iso20022/bundle.zip");
    expect(r.markdown).toContain("## mensaje.xsd");
    expect(r.markdown).toContain("<xs:schema/>");
  });
});

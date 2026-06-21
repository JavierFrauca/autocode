import { describe, expect, test } from "vitest";
import { EMBEDDINGS_DIM } from "@shared";
import { embedTexts } from "../llm/local-embeddings.js";

// Gateado: descarga el modelo bge-m3 (~600 MB) la 1ª vez, así que NO corre en la suite normal.
// Ejecutar con: AUTOCODE_TEST_EMBED=1 vitest run src/main/__tests__/local-embeddings.test.ts
const enabled = process.env.AUTOCODE_TEST_EMBED === "1";

describe.runIf(enabled)("embeddings locales (bge-m3 ONNX)", () => {
  test("devuelve un vector de 1024 dim por texto, normalizado", async () => {
    const vs = await embedTexts(["hola mundo", "transferencia SEPA pain.001"]);
    expect(vs.length).toBe(2);
    expect(vs[0]!.length).toBe(EMBEDDINGS_DIM);
    expect(vs[1]!.length).toBe(EMBEDDINGS_DIM);
    // normalize:true → norma euclídea ~1
    const norm = Math.sqrt(vs[0]!.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeGreaterThan(0.9);
    expect(norm).toBeLessThan(1.1);
  }, 600_000);
});

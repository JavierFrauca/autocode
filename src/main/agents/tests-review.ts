import type { AppConfig } from "@shared";
import { chat } from "../llm/client.js";
import { loadPrompt } from "../prompts.js";
import { extractJson } from "../llm/json.js";
import { listAppFiles, readAppFile } from "./code-workspace.js";
import { log } from "../log.js";

/**
 * REVISIÓN de la suite de pruebas que escribe el builder. No autora tests (eso lo hace el builder
 * contra su código real); AUDITA los que hay:
 *  - Determinista: que cada test ejercite el código REAL (importe de src/ o web/src), no una simulación
 *    que reimplemente la lógica dentro del propio fichero.
 *  - LLM: que cubran los criterios de aceptación de los papers y no sean tautologías (recalcular en el
 *    test con la misma fórmula que el código y comparar).
 * Best-effort: el gate ya garantiza que hay tests reales que pasan; esto añade cobertura/calidad y NO
 * invalida el verde. Devuelve avisos para que el usuario (y la siguiente iteración) los vea.
 */

export interface TestReview {
  /** true = los tests ejercitan el código y cubren los criterios sin avisos relevantes. */
  ok: boolean;
  /** Motivo si no se pudo revisar (sin tests, sin LLM…). */
  skipped?: string;
  /** Frase de resumen de la cobertura. */
  summary?: string;
  /** Avisos de cobertura/calidad (simulaciones, criterios sin cubrir, tautologías…). */
  findings: string[];
}

const TEST_RE = /(^|\/)tests\/.*\.test\.(t|j)sx?$/;
/** Import relativo cuya ruta contiene src (cubre ../src/… y ../web/src/…) o alias '@/…' de la app. */
const REAL_IMPORT_RE = /\bfrom\s+['"](\.[^'"]*src[^'"]*|@\/[^'"]*)['"]/;

async function readTestFiles(ws: string): Promise<{ rel: string; content: string }[]> {
  const rels = (await listAppFiles(ws)).filter((f) => TEST_RE.test(f) && !/readme\.test\./.test(f));
  const out: { rel: string; content: string }[] = [];
  for (const rel of rels) {
    const content = await readAppFile(ws, rel);
    if (content != null) out.push({ rel, content });
  }
  return out;
}

export async function reviewTests(cfg: AppConfig, ws: string, corpus: string): Promise<TestReview> {
  const tests = await readTestFiles(ws);
  if (tests.length === 0) return { ok: false, skipped: "no hay pruebas que revisar", findings: [] };

  // 1) Determinista: tests que NO ejercitan código real (simulaciones).
  const findings: string[] = [];
  for (const t of tests) {
    if (!REAL_IMPORT_RE.test(t.content)) {
      findings.push(`${t.rel} no importa código de src/: parece una simulación (reimplementa la lógica dentro del test).`);
    }
  }

  // 2) LLM: cobertura vs criterios + tautologías. Best-effort; si falla, nos quedamos con lo determinista.
  let summary: string | undefined;
  let llmOk = true;
  try {
    const system = await loadPrompt("tests-review-system");
    const testsBlock = tests
      .map((t) => `### ${t.rel}\n\`\`\`ts\n${t.content.slice(0, 4000)}\n\`\`\``)
      .join("\n\n")
      .slice(0, 24000);
    const res = await chat(
      cfg,
      "code",
      [
        { role: "system", content: system },
        {
          role: "user",
          content:
            `Criterios de aceptación (papers del proyecto):\n\n${corpus.slice(0, 16000)}\n\n` +
            `Pruebas a revisar:\n\n${testsBlock}\n\nDevuelve el JSON de revisión ahora.`,
        },
      ],
      // Sin jsonMode/maxTokens: los modelos de razonamiento no soportan json_object y el razonamiento
      // consume el cap → content vacío. El prompt pide JSON y extractJson es robusto.
      { temperature: 0.1 },
      "tests-review",
    );
    const parsed = extractJson(res.content) as { ok?: boolean; summary?: string; findings?: string[] };
    summary = typeof parsed.summary === "string" ? parsed.summary : undefined;
    if (Array.isArray(parsed.findings)) {
      for (const f of parsed.findings) if (typeof f === "string" && f.trim()) findings.push(f.trim());
    }
    llmOk = parsed.ok !== false;
  } catch (e) {
    log.warn("tests-review", "la auditoría LLM falló; me quedo con la revisión determinista", { err: e });
  }

  return { ok: llmOk && findings.length === 0, summary, findings };
}

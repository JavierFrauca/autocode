import path from "node:path";
import { EMBEDDINGS_DIM } from "@shared";

/**
 * Núcleo de los embeddings locales (bge-m3 vía ONNX, transformers.js). SIN electron y SIN
 * worker_threads: lo carga tanto el worker (`./embed-worker.ts`, el camino normal en la app) como
 * el fallback in-process de `./local-embeddings.ts` (tests/scripts, donde no hay worker compilado).
 * transformers.js se importa de forma perezosa para no cargar onnxruntime al arrancar código que no
 * toca embeddings y para compilar aunque el modelo aún no esté descargado.
 */

type FeatureExtractor = (
  texts: string[],
  opts: Record<string, unknown>,
) => Promise<{ tolist(): number[][] }>;

const MODEL_ID = process.env.AUTOCODE_EMBED_MODEL || "Xenova/bge-m3";
// q8 (cuantizado, ~600 MB) por defecto: mantiene 1024 dim con una fracción del tamaño de fp32 (~2,3 GB).
const DTYPE = process.env.AUTOCODE_EMBED_DTYPE || "q8";

let extractorPromise: Promise<FeatureExtractor> | null = null;

/**
 * Dónde cachear/descargar el modelo. El proceso main de Electron fija `AUTOCODE_MODELS_DIR` al
 * arrancar (a `<userData>/models`) y el worker lo hereda por `process.env`; fuera de Electron
 * (tests/scripts) cae a una carpeta local.
 */
function modelCacheDir(): string {
  if (process.env.AUTOCODE_MODELS_DIR) return path.resolve(process.env.AUTOCODE_MODELS_DIR);
  return path.resolve(process.cwd(), ".autocode-models");
}

async function getExtractor(): Promise<FeatureExtractor> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      env.cacheDir = modelCacheDir();
      env.allowLocalModels = true;
      const extractor = await pipeline("feature-extraction", MODEL_ID, { dtype: DTYPE as never });
      return extractor as unknown as FeatureExtractor;
    })();
  }
  return extractorPromise;
}

/**
 * Embebe textos con bge-m3 (CLS pooling + normalize, como recomienda BAAI para los modelos bge).
 * Devuelve un vector de `EMBEDDINGS_DIM` por texto. El modelo se carga UNA vez y queda caliente.
 */
export async function embedTextsCore(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const extractor = await getExtractor();
  const out = await extractor(texts, { pooling: "cls", normalize: true });
  const vectors = out.tolist();
  for (const v of vectors) {
    if (v.length !== EMBEDDINGS_DIM) {
      throw new Error(`embedding local con dim ${v.length}, esperado ${EMBEDDINGS_DIM}`);
    }
  }
  return vectors;
}

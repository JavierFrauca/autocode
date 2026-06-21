import { existsSync } from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { embedTextsCore } from "./embed-core.js";

/**
 * Interfaz pública de los embeddings locales (bge-m3 vía ONNX). La inferencia se delega a un
 * `worker_thread` (`./embed-worker.ts`) para que la carga del modelo y la presión de CPU no atasquen
 * el event loop del proceso main (Electron + Fastify) → la UI sigue respondiendo durante ingestas
 * grandes. Si el worker compilado no existe (vitest/tsx ejecutan el .ts fuente, no hay `out/main/`)
 * o no se puede crear, caemos a in-process con `embedTextsCore` — misma salida, sin aislamiento.
 *
 * La interfaz (`embedTexts`/`warmupEmbeddings`) NO cambia: los llamantes, el Mutex de la cola y el
 * panel de actividad (en `./client.ts`) siguen igual.
 */

/** Ruta del worker compilado. Existe en la app (electron-vite emite `out/main/embed-worker.js` en
 *  dev y empaquetado); bajo vitest/tsx no existe → null → fallback in-process. */
function workerPath(): string | null {
  const p = path.join(__dirname, "embed-worker.js");
  return existsSync(p) ? p : null;
}

// Se puede forzar in-process con AUTOCODE_EMBED_INPROCESS=1 (depuración/escape).
let useWorker = process.env.AUTOCODE_EMBED_INPROCESS !== "1" && workerPath() !== null;

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: number[][]) => void; reject: (e: any) => void }>();

function ensureWorker(): Worker {
  if (worker) return worker;
  const p = workerPath();
  if (!p) throw new Error("embed-worker.js no encontrado");
  const w = new Worker(p);
  w.unref(); // no impedir que Electron cierre por tener el worker vivo
  w.on("message", (msg: { id: number; vectors?: number[][]; error?: string }) => {
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    if (msg.error) waiter.reject(new Error(msg.error));
    else waiter.resolve(msg.vectors ?? []);
  });
  // Fallo de infraestructura del worker (crash/exit anómalo): rechaza lo pendiente y resetea para
  // que la próxima llamada lo recree. Un error de embedding concreto NO pasa por aquí (se responde
  // con `{ error }` y se propaga al llamante, como antes).
  const fail = (e: Error) => {
    worker = null;
    for (const waiter of pending.values()) waiter.reject(e);
    pending.clear();
  };
  w.on("error", fail);
  w.on("exit", (code) => {
    if (code !== 0) fail(new Error(`embed-worker salió con code=${code}`));
  });
  worker = w;
  return w;
}

/**
 * Embebe textos con bge-m3. Camino normal: lo hace el worker. Si el worker no se puede crear,
 * degrada a in-process de forma permanente.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (!useWorker) return embedTextsCore(texts);

  let w: Worker;
  try {
    w = ensureWorker();
  } catch {
    useWorker = false; // no se pudo crear el worker → in-process permanente
    return embedTextsCore(texts);
  }

  const id = ++seq;
  return new Promise<number[][]>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, texts });
  });
}

/**
 * Pre-carga (y descarga la primera vez) el modelo. Best-effort: si falla, no debe tumbar el arranque;
 * el primer embed real lo reintentará.
 */
export async function warmupEmbeddings(): Promise<void> {
  try {
    await embedTexts(["warmup"]);
  } catch {
    // se ignora a propósito
  }
}

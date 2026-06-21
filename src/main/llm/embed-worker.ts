import { parentPort } from "node:worker_threads";
import { embedTextsCore } from "./embed-core.js";

/**
 * Worker de embeddings: corre bge-m3/ONNX FUERA del proceso main, así la carga del modelo, la
 * tokenización y la presión de CPU no atascan el event loop de Electron/Fastify (la UI sigue
 * respondiendo durante una ingesta grande). Protocolo mínimo: recibe `{ id, texts }`, responde
 * `{ id, vectors }` o `{ id, error }`. El modelo se carga una vez (en `embed-core`) y queda caliente.
 */

if (!parentPort) throw new Error("embed-worker debe ejecutarse como worker_thread");

interface EmbedRequest {
  id: number;
  texts: string[];
}

parentPort.on("message", async (msg: EmbedRequest) => {
  try {
    const vectors = await embedTextsCore(msg.texts);
    parentPort!.postMessage({ id: msg.id, vectors });
  } catch (e: any) {
    parentPort!.postMessage({ id: msg.id, error: String(e?.message ?? e) });
  }
});

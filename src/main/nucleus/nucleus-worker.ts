import { parentPort } from "node:worker_threads";
import { NucleusEngine } from "./engine.js";
import { indexAll, isEmpty, type KbDirs, type ProjectRef } from "./indexer.js";
import { deleteDoc, ingestDoc, searchDomains, type IngestArgs } from "./ops.js";
import { nucleusDbPath, nucleusModelCache } from "./paths.js";

/**
 * Worker de Nucleus: posee el handle del motor y atiende al proceso main por mensajes. Aquí viven las
 * llamadas SÍNCRONAS y bloqueantes (cargan el modelo de embeddings la 1ª vez y consumen CPU), fuera del
 * event loop de Electron/Fastify.
 */

let engine: NucleusEngine | null = null;
function ensureEngine(): NucleusEngine {
  if (!engine) {
    engine = NucleusEngine.open({ dbPath: nucleusDbPath(), modelCache: nucleusModelCache(), indexKind: "flat" });
  }
  return engine;
}

interface Msg {
  id: number;
  type: "isEmpty" | "indexAll" | "ingestDoc" | "deleteDoc" | "search";
  projects?: ProjectRef[];
  kb?: KbDirs;
  domain?: string;
  domains?: string[];
  args?: IngestArgs;
  source?: string;
  query?: string;
  k?: number;
}

parentPort?.on("message", async (msg: Msg) => {
  try {
    let result: unknown;
    switch (msg.type) {
      case "isEmpty":
        result = { empty: isEmpty(ensureEngine()) };
        break;
      case "indexAll":
        result = await indexAll(ensureEngine(), msg.projects ?? [], msg.kb ?? {});
        break;
      case "ingestDoc":
        result = ingestDoc(ensureEngine(), msg.domain!, msg.args!);
        break;
      case "deleteDoc":
        result = { removed: deleteDoc(ensureEngine(), msg.domain!, msg.source!) };
        break;
      case "search":
        result = { hits: searchDomains(ensureEngine(), msg.domains ?? [], msg.query ?? "", msg.k ?? 5) };
        break;
      default:
        throw new Error(`tipo de mensaje desconocido: ${(msg as any).type}`);
    }
    parentPort!.postMessage({ id: msg.id, ok: true, result });
  } catch (e: any) {
    parentPort!.postMessage({ id: msg.id, ok: false, error: e?.message ?? String(e) });
  }
});

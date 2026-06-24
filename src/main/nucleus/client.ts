import { existsSync } from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import type { IndexAllResult, KbDirs, ProjectRef } from "./indexer.js";
import type { IngestArgs, RawHit } from "./ops.js";

/**
 * Cara del proceso MAIN hacia Nucleus: lanza el worker (que posee el motor) y le habla por mensajes.
 * El main nunca toca la DLL ni bloquea: solo enruta peticiones y espera la respuesta.
 */

function workerPath(): string | null {
  const p = path.join(__dirname, "nucleus-worker.js");
  return existsSync(p) ? p : null;
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();

function ensureWorker(): Worker {
  if (worker) return worker;
  const p = workerPath();
  if (!p) throw new Error("nucleus-worker.js no encontrado");
  const w = new Worker(p);
  w.unref();
  w.on("message", (msg: { id: number; ok: boolean; result?: any; error?: string }) => {
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    if (msg.ok) waiter.resolve(msg.result);
    else waiter.reject(new Error(msg.error ?? "error de Nucleus"));
  });
  const fail = (e: Error) => {
    worker = null;
    for (const waiter of pending.values()) waiter.reject(e);
    pending.clear();
  };
  w.on("error", fail);
  w.on("exit", (code) => { if (code !== 0) fail(new Error(`nucleus-worker salió con code=${code}`)); });
  worker = w;
  return w;
}

function call<T = any>(type: string, payload: Record<string, unknown> = {}): Promise<T> {
  const w = ensureWorker();
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, type, ...payload });
  });
}

/** ¿La BBDD de Nucleus está vacía (sin datos indexados)? */
export function nucleusIsEmpty(): Promise<boolean> {
  return call<{ empty: boolean }>("isEmpty").then((r) => r.empty);
}

/** Indexa todos los proyectos + catálogos (diferido, en el worker). */
export function nucleusIndexAll(projects: ProjectRef[], kb: KbDirs = {}): Promise<IndexAllResult> {
  return call<IndexAllResult>("indexAll", { projects, kb });
}

/** Ingesta/re-indexa un documento en un dominio (idempotente por `source`). */
export function nucleusIngestDoc(domain: string, args: IngestArgs): Promise<{ document_id: number; chunk_count: number }> {
  return call("ingestDoc", { domain, args });
}

/** Saca un documento del índice. */
export function nucleusDeleteDoc(domain: string, source: string): Promise<{ removed: number }> {
  return call("deleteDoc", { domain, source });
}

/** Borra un dominio entero (al eliminar un proyecto). En cascada. */
export function nucleusDeleteDomain(domain: string): Promise<{ removed: number }> {
  return call("deleteDomain", { domain });
}

/** Búsqueda híbrida (vector + BM25) en uno o varios dominios; fusiona por score. */
export function nucleusSearch(domains: string[], query: string, k = 5): Promise<RawHit[]> {
  return call<{ hits: RawHit[] }>("search", { domains, query, k }).then((r) => r.hits);
}

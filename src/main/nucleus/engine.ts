import koffi from "koffi";
import { nucleusDllPath } from "./paths.js";

/**
 * Wrapper TS sobre el C ABI de `nucleus.dll` (motor RAG in-process). Verificado con koffi:
 * - El handle del motor sale por `_Out_ void**` (lo recibimos como puntero/BigInt).
 * - Las llamadas con datos toman JSON y devuelven JSON por `char**`; usamos un tipo `disposable`
 *   de koffi que decodifica el string Y lo libera con `nucleus_string_free` (sin fugas).
 * - Cada llamada devuelve int: 0 = ok; <0 = error (mensaje en el JSON y en `nucleus_last_error`).
 *
 * Las llamadas son SÍNCRONAS y bloquean (ingest/search hacen embedding en CPU). Por eso este wrapper
 * se usa SIEMPRE dentro de un worker_thread (ver `nucleus-worker.ts`), nunca en el hilo principal.
 */

interface Fns {
  open: koffi.KoffiFunction;
  close: koffi.KoffiFunction;
  last_error: koffi.KoffiFunction;
  create_domain: koffi.KoffiFunction;
  ingest_text: koffi.KoffiFunction;
  search: koffi.KoffiFunction;
  list_domains: koffi.KoffiFunction;
  list_documents: koffi.KoffiFunction;
  delete_document: koffi.KoffiFunction;
  persist: koffi.KoffiFunction;
}

let fns: Fns | null = null;

function loadLib(): Fns {
  if (fns) return fns;
  const lib = koffi.load(nucleusDllPath());
  const string_free = lib.func("void nucleus_string_free(void* s)");
  // Tipo de salida que se auto-decodifica a string JS y se libera con el liberador del propio motor.
  koffi.disposable("NucleusOwnedStr", "char*", string_free);
  fns = {
    open: lib.func("int nucleus_open(const char* config_json, _Out_ void** out_handle)"),
    close: lib.func("void nucleus_close(void* handle)"),
    last_error: lib.func("const char* nucleus_last_error()"),
    create_domain: lib.func("int nucleus_create_domain(void* handle, const char* input_json, _Out_ NucleusOwnedStr* out_json)"),
    ingest_text: lib.func("int nucleus_ingest_text(void* handle, const char* input_json, _Out_ NucleusOwnedStr* out_json)"),
    search: lib.func("int nucleus_search(void* handle, const char* input_json, _Out_ NucleusOwnedStr* out_json)"),
    list_domains: lib.func("int nucleus_list_domains(void* handle, _Out_ NucleusOwnedStr* out_json)"),
    list_documents: lib.func("int nucleus_list_documents(void* handle, const char* input_json, _Out_ NucleusOwnedStr* out_json)"),
    delete_document: lib.func("int nucleus_delete_document(void* handle, const char* input_json, _Out_ NucleusOwnedStr* out_json)"),
    persist: lib.func("int nucleus_persist_indexes(void* handle, _Out_ NucleusOwnedStr* out_json)"),
  };
  return fns;
}

export interface OpenOptions {
  dbPath: string;
  modelCache?: string;
  indexDir?: string;
  indexKind?: "flat" | "hnsw";
  gpu?: boolean;
}

export interface IngestInput {
  domain_id: number;
  title: string;
  text: string;
  source?: string;
  metadata?: Record<string, string>;
  labels?: string[];
  subdomain?: string;
}

export interface SearchInput {
  domain_id: number;
  query: string;
  k?: number;
  labels?: string[];
  match_all?: boolean;
  document_ids?: number[];
  subdomain?: string;
  filter?: string;
}

export class NucleusEngine {
  private handle: unknown;
  private readonly f: Fns;

  private constructor(handle: unknown, f: Fns) {
    this.handle = handle;
    this.f = f;
  }

  static open(opts: OpenOptions): NucleusEngine {
    const f = loadLib();
    const cfg: Record<string, unknown> = { db_path: opts.dbPath };
    if (opts.modelCache) cfg.model_cache = opts.modelCache;
    if (opts.indexDir) cfg.index_dir = opts.indexDir;
    if (opts.indexKind) cfg.index_kind = opts.indexKind;
    if (opts.gpu) cfg.gpu = true;
    const out: unknown[] = [null];
    const rc = f.open(JSON.stringify(cfg), out);
    if (rc !== 0) throw new Error(`nucleus_open falló: ${f.last_error()}`);
    return new NucleusEngine(out[0], f);
  }

  /** Llamada genérica: (handle [, jsonInput], out) → parsea el JSON de salida o lanza. */
  private call(fn: koffi.KoffiFunction, input?: object): any {
    const out: unknown[] = [null];
    const rc = input === undefined
      ? fn(this.handle, out)
      : fn(this.handle, JSON.stringify(input), out);
    const payload = out[0] as string | null;
    if (rc !== 0) throw new Error(`nucleus error ${rc}: ${payload ?? this.f.last_error()}`);
    return payload ? JSON.parse(payload) : null;
  }

  createDomain(name: string, model?: string): any {
    return this.call(this.f.create_domain, model ? { name, model } : { name });
  }
  ingestText(input: IngestInput): { document_id: number; chunk_count: number } {
    return this.call(this.f.ingest_text, input);
  }
  search(input: SearchInput): { hits: { chunk: any; score: number }[] } {
    return this.call(this.f.search, input);
  }
  listDomains(): { domains: any[] } {
    return this.call(this.f.list_domains);
  }
  listDocuments(domainId: number, offset = 0, limit = 100): { documents: any[] } {
    return this.call(this.f.list_documents, { domain_id: domainId, offset, limit });
  }
  deleteDocument(documentId: number): any {
    return this.call(this.f.delete_document, { document_id: documentId });
  }
  persist(): any {
    return this.call(this.f.persist);
  }
  close(): void {
    if (this.handle) {
      this.f.close(this.handle);
      this.handle = null;
    }
  }
}

// Smoke de enlace koffi ↔ nucleus.dll. NO descarga el modelo (open/create_domain/list_domains son
// operaciones de storage; el embedder se carga perezosamente en el primer ingest/search).
//   node scripts/nucleus-smoke.cjs
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const koffi = require("koffi");

const dll = path.resolve(__dirname, "../vendor/nucleus/nucleus.dll");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nucleus-smoke-"));
const dbPath = path.join(tmp, "nucleus.redb");

console.log("DLL:", dll);
console.log("DB :", dbPath);

const lib = koffi.load(dll);

const nucleus_open        = lib.func("int nucleus_open(const char* config_json, _Out_ void** out_handle)");
const nucleus_close       = lib.func("void nucleus_close(void* handle)");
const nucleus_string_free = lib.func("void nucleus_string_free(void* s)");
const nucleus_last_error  = lib.func("const char* nucleus_last_error()");
// Dejamos que koffi decodifique el char** de salida directamente a string JS (out param `_Out_ char**`).
// (Para el smoke no liberamos ese string → leak mínimo; en el wrapper de producción usaremos el puntero.)
const nucleus_create_domain = lib.func("int nucleus_create_domain(void* handle, const char* input_json, _Out_ char** out_json)");
const nucleus_list_domains  = lib.func("int nucleus_list_domains(void* handle, _Out_ char** out_json)");

(function main() {
  const hOut = [null];
  const rc = nucleus_open(JSON.stringify({ db_path: dbPath, model_cache: path.join(tmp, "models"), index_kind: "flat" }), hOut);
  if (rc !== 0) throw new Error(`nucleus_open rc=${rc} last_error=${nucleus_last_error()}`);
  const handle = hOut[0];
  console.log("✓ nucleus_open ok, handle:", handle);

  console.log("→ create_domain…");
  const dOut = [null];
  const drc = nucleus_create_domain(handle, JSON.stringify({ name: "proyecto-demo" }), dOut);
  console.log("  rc=", drc, "out=", dOut[0]);
  if (drc !== 0) throw new Error(`create_domain rc=${drc} last_error=${nucleus_last_error()}`);

  console.log("→ list_domains…");
  const lOut = [null];
  const lrc = nucleus_list_domains(handle, lOut);
  console.log("  rc=", lrc, "out=", lOut[0]);
  if (lrc !== 0) throw new Error(`list_domains rc=${lrc} last_error=${nucleus_last_error()}`);

  console.log("→ close…");
  nucleus_close(handle);
  console.log("✓ nucleus_close ok");
  console.log("\nSMOKE OK — koffi enlaza nucleus.dll correctamente.");
})();

/*
 * Diagnóstico: ¿el modelo del rol `code` (vía LiteLLM) soporta function-calling de verdad?
 * Es la prueba de fuego del agente builder único: si no emite tool_calls, el agente devuelve
 * `unsupported` y escala. Lee la config REAL de la BD (AppData) y hace 2 llamadas con tools.
 *
 * Cómo ejecutarlo (necesita el binario de Electron por el better-sqlite3 nativo):
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe scripts/fc-probe.cjs   (bash)
 *   $env:ELECTRON_RUN_AS_NODE=1; node_modules/electron/dist/electron.exe scripts/fc-probe.cjs   (PowerShell)
 *
 * Requiere que el gateway LiteLLM esté arriba (p.ej. http://192.168.1.38:4000).
 */
const path = require("node:path");
const os = require("node:os");
const Database = require("better-sqlite3");
const OpenAINS = require("openai");
const OpenAI = OpenAINS.OpenAI ?? OpenAINS.default ?? OpenAINS;

function dbPath() {
  if (process.env.AUTOCODE_DB_PATH) return path.resolve(process.env.AUTOCODE_DB_PATH);
  return path.join(os.homedir(), "AppData", "Roaming", "autocode", "autocode.db");
}

function loadCfg() {
  const db = new Database(dbPath(), { readonly: true, fileMustExist: true });
  const row = db.prepare("SELECT value FROM app_config WHERE id='default'").get();
  db.close();
  if (!row) throw new Error("no hay fila app_config 'default'");
  return typeof row.value === "string" ? JSON.parse(row.value) : row.value;
}

function classify(e) {
  const m = String(e?.message ?? e);
  if (/Connection error|ECONNREFUSED|ETIMEDOUT|fetch failed|ENOTFOUND|socket hang up/i.test(m)) {
    return "❌ endpoint INALCANZABLE (gateway caído o red) — no concluye sobre tools";
  }
  if (/tool|function|unsupported|not supported|400|422/i.test(m)) {
    return "❌ el endpoint/modelo RECHAZA el parámetro tools";
  }
  return `❌ error: ${m.slice(0, 200)}`;
}

async function main() {
  const cfg = loadCfg();
  const baseURL = (cfg.litellm?.baseUrl || "").replace(/\/$/, "") + "/v1";
  const apiKey = cfg.litellm?.apiKey || "";
  const model = cfg.models?.code?.model || "";
  console.log("DB:", dbPath());
  console.log("baseURL:", baseURL);
  console.log("apiKey:", apiKey ? apiKey.slice(0, 6) + "…(" + apiKey.length + " chars)" : "(vacía)");
  console.log("code model:", model || "(no configurado)");
  if (!baseURL || !apiKey || !model) { console.log("\nFALTA configuración → no puedo probar."); return; }

  const client = new OpenAI({ baseURL, apiKey, maxRetries: 0, timeout: 20_000 });
  const tools = [{
    type: "function",
    function: {
      name: "escribir_fichero",
      description: "Crea o reemplaza un fichero con el contenido dado.",
      parameters: {
        type: "object",
        properties: { ruta: { type: "string" }, contenido: { type: "string" } },
        required: ["ruta", "contenido"],
      },
    },
  }];
  const messages = [
    { role: "system", content: "Eres un agente con tools. Usa escribir_fichero cuando proceda." },
    { role: "user", content: "Crea hola.txt con el contenido exacto: Hola mundo" },
  ];

  for (const choice of ["auto", "required"]) {
    console.log(`\n=== tool_choice=${choice} ===`);
    try {
      const t0 = Date.now();
      const res = await client.chat.completions.create({ model, temperature: 0, tools, tool_choice: choice, messages });
      const ms = Date.now() - t0;
      const msg = res.choices?.[0]?.message;
      const calls = msg?.tool_calls ?? [];
      console.log(`respondió en ${ms}ms · finish_reason=${res.choices?.[0]?.finish_reason} · tool_calls=${calls.length}`);
      if (calls.length) {
        for (const c of calls) console.log("  →", c.function?.name, c.function?.arguments);
        console.log("VEREDICTO: ✅ EMITE TOOL CALLS — el agente único puede operar con este modelo");
      } else {
        console.log("contenido:", (msg?.content ?? "").slice(0, 200));
        console.log("VEREDICTO: ❌ NO usó la tool (respondió texto)");
      }
    } catch (e) {
      console.log("VEREDICTO:", classify(e));
    }
  }
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });

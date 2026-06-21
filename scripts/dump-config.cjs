/* Vuelca la config de LLM (URL/key/modelo code) como líneas `export` para pasarla por env a un test
 * en vivo SIN imprimir el secreto en claro (se consume con eval). Correr bajo Electron (better-sqlite3). */
const path = require("node:path");
const os = require("node:os");
const Database = require("better-sqlite3");
const dbPath = process.env.AUTOCODE_DB_PATH || path.join(os.homedir(), "AppData", "Roaming", "autocode", "autocode.db");
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const row = db.prepare("SELECT value FROM app_config WHERE id='default'").get();
db.close();
const c = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
// Config nueva: c.generation.{baseUrl,apiKey,mainModel}. Fallback a la vieja c.litellm/c.models por si acaso.
const g = c.generation ?? {};
const baseUrl = g.baseUrl || c.litellm?.baseUrl || "";
const apiKey = g.apiKey || c.litellm?.apiKey || "";
const model = g.mainModel || c.models?.code?.model || "";
process.stdout.write(
  `export AUTOCODE_LITELLM_URL=${baseUrl}\n` +
  `export AUTOCODE_LITELLM_KEY=${apiKey}\n` +
  `export AUTOCODE_CODE_MODEL=${model}\n`,
);

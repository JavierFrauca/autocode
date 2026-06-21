/**
 * Verificación: ¿el modelo configurado es capaz de ir creando los papers?
 * Reproduce la invocación real del agente documenter (prompts/documenter-system.md
 * + transcript de conversación) contra la LiteLLM del usuario y valida el JSON.
 *
 * Ejecutar con el binario de Electron en modo Node para que better-sqlite3 cargue:
 *   ELECTRON_RUN_AS_NODE=1 <electron> scripts/verify-documenter.cjs
 */
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const DB_PATH =
  process.env.AUTOCODE_DB_PATH ||
  path.join(os.homedir(), "AppData", "Roaming", "AutoCode", "autocode.db");

function readConfig() {
  const Database = require("better-sqlite3");
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  const row = db.prepare("select value from app_config where id = 'default'").get();
  db.close();
  if (!row) throw new Error("No hay fila de config 'default' en app_config");
  return typeof row.value === "string" ? JSON.parse(row.value) : row.value;
}

// extractJson minimal (espejo de src/main/llm/json.ts)
function extractJson(raw) {
  const text = (raw ?? "").trim();
  try { return JSON.parse(text); } catch {}
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) { try { return JSON.parse(fenced[1]); } catch {} }
  // primer objeto balanceado
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") { depth--; if (depth === 0) { try { return JSON.parse(text.slice(i, j + 1)); } catch {} break; } }
    }
  }
  throw new Error("respuesta no parseable como JSON");
}

const SESSION_ID = "ses_verify_demo";
const CONVERSATION = [
  { role: "user", content: "Quiero una aplicación para gestionar los recibos de un fichero SEPA. Le paso un fichero XML de remesa (pain.001) y quiero poder borrar recibos y cambiar importes." },
  { role: "assistant", content: "Entendido. ¿Debe recalcular la suma de control (CtrlSum) y el número de operaciones (NbOfTxs) de la cabecera cuando borres un recibo o cambies un importe?" },
  { role: "user", content: "Sí, exacto. Que siempre quede coherente: si borro un recibo se resta del total y se actualiza el contador. Y que valide los IBAN antes de exportar." },
  { role: "assistant", content: "Perfecto. Será una app de escritorio monopuesto. Validará IBAN, recalculará CtrlSum y NbOfTxs en cada operación y reexportará un XML pain.001 válido." },
];

async function main() {
  console.log("== Verificación documenter ==");
  console.log("DB:", DB_PATH);

  const cfg = readConfig();
  const baseUrl = cfg?.litellm?.baseUrl;
  const apiKey = cfg?.litellm?.apiKey;
  const cheapModel = cfg?.models?.cheap?.model;
  const docsModel = cfg?.models?.docs?.model;
  // Mismo criterio que agents/documenter.ts: rol `docs` si está, si no `cheap`.
  const model = process.env.VERIFY_MODEL || docsModel || cheapModel;
  console.log("LiteLLM baseUrl:", baseUrl || "(vacío)");
  console.log("Modelo 'docs' configurado:", docsModel || "(vacío → fallback a cheap)");
  console.log("Modelo 'cheap' configurado:", cheapModel || "(vacío)");
  console.log("Modelo USADO en esta prueba:", model, process.env.VERIFY_MODEL ? "(override)" : "");

  if (!baseUrl || !apiKey || !cheapModel) {
    console.error("\n❌ Config incompleta: el documenter usa el rol 'cheap'. Falta baseUrl/apiKey/modelo.");
    process.exit(2);
  }

  const OpenAI = require("openai");
  const client = new (OpenAI.default || OpenAI)({
    baseURL: baseUrl.replace(/\/$/, "") + "/v1",
    apiKey,
  });

  const system = fs.readFileSync(path.join(__dirname, "..", "prompts", "documenter-system.md"), "utf-8");
  const transcript = CONVERSATION.map((m) => `[${m.role}]: ${m.content}`).join("\n\n");
  const user = `Proyecto: Editor de remesas SEPA\nSessionId: ${SESSION_ID}\n\nÚltimos mensajes:\n${transcript}\n\nDevuelve el JSON ahora.`;

  console.log("\nLlamando al modelo...");
  const t0 = Date.now();
  let res;
  try {
    res = await client.chat.completions.create({
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      temperature: 0.1,
    });
  } catch (e) {
    console.error("\n❌ Error llamando a LiteLLM:", e.message || String(e));
    process.exit(3);
  }
  const ms = Date.now() - t0;
  const content = res.choices?.[0]?.message?.content ?? "";
  console.log(`Respuesta en ${ms}ms · ${content.length} chars · tokens_out=${res.usage?.completion_tokens ?? "?"}`);

  let parsed;
  try {
    parsed = extractJson(content);
  } catch (e) {
    console.error("\n❌ El modelo NO devolvió JSON parseable. Inicio de la respuesta:");
    console.error(content.slice(0, 400));
    process.exit(4);
  }

  // Validaciones
  const problems = [];
  if (!parsed.historial) problems.push("falta bloque 'historial'");
  if (parsed.historial && parsed.historial.sessionId !== SESSION_ID)
    problems.push(`sessionId del historial no coincide (esperado ${SESSION_ID}, vino ${parsed.historial?.sessionId})`);
  const ficheros = Array.isArray(parsed.ficheros) ? parsed.ficheros : [];
  if (ficheros.length === 0) problems.push("no generó ningún fichero (esperábamos al menos 1)");

  let withContent = 0;
  for (const f of ficheros) {
    if (f.ruta && typeof f.contenido === "string" && f.contenido.trim().length > 20) withContent++;
  }

  console.log("\n== Resultado ==");
  console.log("historial presente:", !!parsed.historial);
  console.log("ficheros generados:", ficheros.length, "· con contenido válido:", withContent);
  if (ficheros.length > 0 && withContent === 0) {
    console.log("\n⚠️  Fichero(s) sin contenido. Volcado crudo del primero:");
    console.log(JSON.stringify(ficheros[0], null, 2).slice(0, 800));
  }
  for (const f of ficheros) {
    const firstLine = (f.contenido || "").split("\n").find((l) => l.trim()) || "";
    console.log(`  • [${f.docType || "?"}] ${f.ruta}  ->  ${firstLine.slice(0, 70)}`);
  }

  // Muestra el primer paper completo
  if (ficheros[0]?.contenido) {
    console.log("\n== Primer paper (contenido completo) ==");
    console.log("ruta:", ficheros[0].ruta);
    console.log("----");
    console.log(ficheros[0].contenido);
    console.log("----");
  }

  if (problems.length) {
    console.log("\n⚠️  Observaciones:", problems.join("; "));
  }

  const ok = !!parsed.historial && ficheros.length >= 1 && withContent >= 1;
  console.log("\n" + (ok ? "✅ El modelo ES capaz de crear papers coherentes." : "❌ El modelo no produjo papers utilizables."));
  process.exit(ok ? 0 : 5);
}

main().catch((e) => { console.error("fallo inesperado:", e); process.exit(1); });

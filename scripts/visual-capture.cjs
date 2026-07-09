/*
 * Arnés de captura visual (corre BAJO Electron, no como node). Carga una URL/fichero en una ventana
 * OCULTA, espera a que pinte, captura un PNG y emite un veredicto JSON con heurísticas de "se ve algo"
 * (no pantalla en blanco, sin crash de render, DOM con texto). Lo usa `verify-visual.ts` para validar
 * que la app generada RENDERIZA de verdad (no solo que compila).
 *
 * Uso: electron scripts/visual-capture.cjs --url=<file|http> --out=<png> [--verdict=<json>] [--timeout=ms]
 *      [--w=1200] [--h=800] [--cookie=nombre=valor]
 * `--cookie`: inyecta una cookie de sesión (httpOnly) ANTES de cargar la URL, para poder capturar
 * pantallas que exigen login (apps `server`) sin simular clics en el formulario.
 * Exit 0 = ok visual; 1 = renderizó pero con problemas; 2 = no pudo ni cargar.
 */
const { app, BrowserWindow, session } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

function arg(name, def) {
  const pref = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : def;
}

const url = arg("url");
const out = arg("out", path.join(process.cwd(), "screenshot.png"));
const verdictPath = arg("verdict", out + ".json");
const timeout = Number(arg("timeout", "15000"));
const width = Number(arg("w", "1200"));
const height = Number(arg("h", "800"));
const cookieArg = arg("cookie"); // "nombre=valor"

// Sin GPU/headless-friendly: en servidores sin aceleración, evita cuelgues de render.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("no-sandbox");

const findings = [];
let finished = false;

function writeVerdict(ok, extra) {
  const verdict = { ok, url, out: fs.existsSync(out) ? out : null, findings, ...extra };
  try { fs.mkdirSync(path.dirname(verdictPath), { recursive: true }); } catch {}
  try { fs.writeFileSync(verdictPath, JSON.stringify(verdict, null, 2)); } catch {}
  console.log("VERDICT " + JSON.stringify(verdict));
}

app.whenReady().then(() => {
  if (!url) { writeVerdict(false, { error: "falta --url" }); app.exit(2); return; }

  const win = new BrowserWindow({
    show: false, width, height,
    webPreferences: { sandbox: false, offscreen: false },
  });

  win.webContents.on("console-message", (_e, level, message) => {
    const msg = String(message);
    // Ignora los avisos de seguridad que Electron imprime en dev (CSP/unsafe-eval): son ruido suyo,
    // no fallos de la app generada.
    if (/Electron Security Warning|Insecure Content-Security-Policy/i.test(msg)) return;
    if (level >= 3) findings.push({ type: "console-error", message: msg.slice(0, 300) });
  });
  win.webContents.on("render-process-gone", (_e, d) => findings.push({ type: "renderer-gone", reason: d && d.reason }));
  win.webContents.on("did-fail-load", (_e, code, desc) => {
    if (code && code !== -3) findings.push({ type: "did-fail-load", code, desc }); // -3 = abort, ruido
  });

  const guard = setTimeout(() => { if (!finished) { findings.push({ type: "timeout" }); capture(false); } }, timeout);

  const COUNT_SCRIPT =
    "({" +
    "inputs: document.querySelectorAll('input,select,textarea').length," +
    "buttons: document.querySelectorAll('button').length," +
    "tableRows: document.querySelectorAll('tr').length" +
    "})";

  async function capture(loaded) {
    if (finished) return;
    finished = true;
    clearTimeout(guard);
    let blank = null;
    let textLen = null;
    let counts = null;
    try {
      const img = await win.webContents.capturePage();
      const png = img.toPNG();
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, png);
      blank = png.length < 2000; // un PNG diminuto ≈ pantalla en blanco
    } catch (e) {
      findings.push({ type: "capture-throw", message: String((e && e.message) || e).slice(0, 200) });
    }
    try {
      textLen = await win.webContents.executeJavaScript("document.body ? document.body.innerText.trim().length : 0");
      if (textLen === 0) findings.push({ type: "empty-dom" });
    } catch {}
    try {
      counts = await win.webContents.executeJavaScript(COUNT_SCRIPT);
    } catch {}
    const fatal = findings.some((f) => ["renderer-gone", "did-fail-load", "load-throw", "timeout"].includes(f.type));
    const ok = !!loaded && !fatal && blank !== true && (textLen == null || textLen > 0);
    writeVerdict(ok, { blank, textLen, counts });
    app.exit(ok ? 0 : 1);
  }

  win.webContents.once("did-finish-load", () => setTimeout(() => capture(true), 800));

  async function start() {
    if (cookieArg) {
      const eq = cookieArg.indexOf("=");
      if (eq > 0) {
        const name = cookieArg.slice(0, eq);
        const value = cookieArg.slice(eq + 1);
        try {
          await session.defaultSession.cookies.set({ url, name, value, httpOnly: true, sameSite: "lax" });
        } catch (e) {
          findings.push({ type: "cookie-set-throw", message: String((e && e.message) || e).slice(0, 200) });
        }
      }
    }
    const loader = /^https?:/i.test(url) ? win.loadURL(url) : win.loadFile(url);
    return Promise.resolve(loader);
  }

  start().catch((e) => {
    findings.push({ type: "load-throw", message: String((e && e.message) || e).slice(0, 200) });
    capture(false);
  });
});

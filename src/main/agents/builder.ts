import type { AppConfig, AppType } from "@shared";
import { runToolLoop, type ChatMessage } from "../llm/client.js";
import { loadPrompt } from "../prompts.js";
import { buildAgentTools, countTscErrors } from "./agent-tools.js";
import { listAppFiles, readAppFile } from "./code-workspace.js";
import { runVitest, typecheckApp, type VitestResult } from "./qa-exec.js";
import { log } from "../log.js";

/**
 * ¿El renderer sigue siendo el placeholder del andamiaje? Para apps andamiadas con UI (escritorio/web),
 * "compila + renderiza" lo cumple el placeholder, así que el agente podría parar sin construir las
 * pantallas reales. Mientras el sentinel siga presente, la app NO está terminada.
 *
 * El andamiaje moderno trae una CÁSCARA permanente (shell con menú lateral) en App.vue y el placeholder
 * vive en la vista de inicio (views/InicioView.vue) — así el agente NO toca el shell, solo reemplaza la
 * vista. Comprobamos AMBOS sitios (la vista de inicio y App.vue) para cubrir el shell nuevo y cualquier
 * app antigua donde el sentinel siguiera en App.vue.
 */
async function rendererIsPlaceholder(ws: string, appType: AppType): Promise<boolean> {
  // Las vistas viven en sitios distintos según el tipo: electron en src/renderer/src, web en web/src.
  const base = appType === "server" ? "web/src" : "src/renderer/src";
  const candidatos = [`${base}/views/InicioView.vue`, `${base}/App.vue`];
  for (const rel of candidatos) {
    const contenido = await readAppFile(ws, rel);
    if (contenido != null && contenido.includes("AUTOCODE:PLACEHOLDER")) return true;
  }
  return false;
}

/** Ficheros de prueba del workspace (tests/**.test.ts|js). */
async function listTestFiles(ws: string): Promise<string[]> {
  const all = await listAppFiles(ws);
  return all.filter((f) => /(^|\/)tests\/.*\.test\.(t|j)sx?$/.test(f));
}

/**
 * ¿Hay al menos un test que ejercita el CÓDIGO REAL de la app (importa de src/ o web/src)? Los tests
 * "simulación" —que se reimplementan la lógica DENTRO del propio fichero y comprueban esa copia— no
 * valen: dan verde sin tocar la app y pueden ser contradictorios consigo mismos (deadlock). El de
 * README queda exento (verifica el README, no código). Es el equivalente a `uiPending` para pruebas.
 */
async function hasRealTests(ws: string, testFiles: string[]): Promise<boolean> {
  for (const rel of testFiles) {
    if (/readme\.test\./.test(rel)) continue;
    const src = await readAppFile(ws, rel);
    // Import RELATIVO cuya ruta contiene src (cubre ../src/… y ../web/src/…) o alias '@/…' de la app.
    if (src && /\bfrom\s+['"](\.[^'"]*src[^'"]*|@\/[^'"]*)['"]/.test(src)) return true;
  }
  return false;
}

/**
 * EL AGENTE BUILDER ÚNICO. Sustituye a la orquestación rígida (planner→coder→qa→fixer con fases):
 * un solo agente, en bucle de tools, lee la documentación y las plantillas, escribe el código, lo
 * compila, lo repara y hace pasar las pruebas, hasta verde o estancamiento.
 *
 * Diseño clave — la MEMORIA es el sistema de ficheros, no el historial de chat. Cada "ciclo" arranca
 * un bucle de tools fresco con un mensaje de estado compacto (el plan + el veredicto del último gate);
 * el agente reconstruye lo que necesita leyendo el código del disco con sus tools. Así el contexto
 * queda ACOTADO por ciclo (no crece sin límite) y el agente nunca trabaja sobre una foto obsoleta.
 *
 * El GATE es determinista (compila + tests reales de qa-exec): el agente lo VE pero no lo FALSEA.
 * Guardarraíles: presupuesto (nº de ciclos × rondas) y estancamiento (si la métrica no mejora).
 */

export interface BuilderProgress {
  /** Tras cerrar un ciclo de tools (antes del gate): qué tools usó el agente. */
  onCycle?: (cycle: number, toolsUsed: string[]) => Promise<void> | void;
  /** Tras el gate determinista de un ciclo: estado de compilación/pruebas. */
  onGate?: (cycle: number, info: { compileErrors: number; compiledGreen: boolean; testsFailed: number | null }) => Promise<void> | void;
}

export interface BuilderOptions {
  projectId: string;
  appType: AppType;
  /** Plan vivo (markdown) para centrar la construcción. */
  planContext?: string;
  /** Pistas del usuario al reintentar/reparar (chat o pantalla). */
  userFeedback?: string;
  /** true si ya hay código generado: el agente REPARA en vez de construir de cero. */
  repair?: boolean;
  /** true si el PROGRAMA ya colocó el andamiaje dorado (electron-vite que renderiza): el agente
   *  construye ENCIMA, no lo recrea. */
  scaffolded?: boolean;
  /** Meta del pase. "app" (def.): construir/reparar la aplicación (compila + UI real). "tests": fase
   *  DEDICADA a escribir las pruebas de aceptación reales (importan de src/ y ejercitan el código) y
   *  hacerlas pasar, con su PROPIO presupuesto — se ejecuta tras tener la app verde. El builder es dueño
   *  del test y del código, así que puede reconciliar ambos (sin el deadlock de los tests congelados). */
  goal?: "app" | "tests";
  /** Presupuesto de ciclos para ESTE pase. Escala con el tamaño del plan (1 pantalla ≠ 16 pantallas).
   *  Si no se da, usa el valor base. El estancamiento (3 ciclos sin mejorar) sigue cortando antes si se atasca. */
  maxCycles?: number;
  progress?: BuilderProgress;
}

export interface BuilderResult {
  status: "green" | "stalled" | "unsupported";
  compiledGreen: boolean;
  compileErrors: number;
  compileOutput: string;
  testsRan: boolean;
  testsFailed: number;
  testsTotal: number;
  cycles: number;
  /** Al parar: la UI seguía siendo el placeholder (no se construyeron las pantallas reales). */
  uiPending: boolean;
}

/** Dependencias inyectables (para test): por defecto, el bucle de tools real y el prompt del disco. */
export interface BuilderDeps {
  toolLoop?: typeof runToolLoop;
  /** System prompt ya resuelto (evita tocar el disco/electron en test). */
  systemPrompt?: string;
}

const MAX_GATE_CYCLES = 8;        // cuántas veces reabrimos al agente tras un gate en rojo
const TOOL_ROUNDS_PER_CYCLE = 18; // rondas de tool-calling dentro de cada ciclo
const STALL_LIMIT = 3;            // ciclos seguidos sin mejorar la métrica → estancado (UI/tests: aquí SÍ puede
                                   // ayudar una aclaración del usuario, así que no insistimos de más)
// Fallos de COMPILACIÓN son distintos: el usuario NO SABE PROGRAMAR, así que enseñarle un error de
// TypeScript no le sirve de nada — solo el agente puede resolverlo. Le damos más margen antes de
// rendirse y pedirle ayuda a una persona que no puede dársela.
const COMPILE_STALL_LIMIT = 6;
// Nº de líneas iniciales del error que comparamos para detectar "sigue siendo el MISMO fallo".
const ERROR_SIGNATURE_LINES = 3;

/** Firma corta del error de compilación (para detectar si el agente repite el mismo fallo ciclo tras ciclo). */
function errorSignature(errors: string): string {
  return errors.split("\n").slice(0, ERROR_SIGNATURE_LINES).join("\n").trim();
}

/** Métrica de progreso (cuanto menor, mejor). Fases: no-compila ≫ UI-placeholder ≫ faltan-tests ≫ tests-rojos ≫ verde. */
function gateMetric(compileRan: boolean, compiledGreen: boolean, compileErrors: number, vitest: VitestResult | null, uiPending: boolean, testsPending: boolean): number {
  if (!compileRan) return 5_000_000;                      // ni siquiera hay andamiaje que compilar
  if (!compiledGreen) return 1_000_000 + compileErrors;   // fase de compilación
  if (uiPending) return 500_000;                          // compila pero la UI real aún no está (placeholder)
  if (testsPending) return 300_000;                       // compila pero faltan tests REALES que ejerciten src/
  if (vitest && vitest.ran) return vitest.failed;         // fase de pruebas
  return 0;                                                // compila y sin pendientes
}

/** Mensaje de arranque: qué construir (plan + tipo + feedback). El agente reconstruye el resto leyendo el disco. */
function buildIntro(opts: BuilderOptions): string {
  if (opts.goal === "tests") {
    const parts: string[] = [
      "La aplicación YA ESTÁ CONSTRUIDA y COMPILA. Tu ÚNICA tarea ahora es escribir las **PRUEBAS DE " +
        "ACEPTACIÓN** y hacerlas pasar. NO rehagas la app ni cambies su estructura.",
      "Cómo:",
      "1. Lee los criterios de aceptación con `buscar_documentacion` (reglas de negocio, ejemplos numéricos).",
      "2. Inspecciona el código REAL con `listar_ficheros`/`leer_fichero` para saber qué módulos importar y " +
        "qué firmas tienen (dominio/servicios en `src/`, y `web/src` si aplica).",
      "3. Escribe tests Vitest en `tests/` que **IMPORTEN ese código real** (p.ej. " +
        "`import { calcularAnual } from \"../src/application/...\"`) y lo EJERCITEN. Al menos uno por criterio.",
      "   - PROHIBIDO reimplementar la lógica DENTRO del test y comprobar esa copia (simulación: no prueba " +
        "la app y puede contradecirse). El test DEBE importar de `src/`/`web/src`.",
      "   - Los valores esperados (golden) salen de los EJEMPLOS de los papers o de un cálculo a mano; si un " +
        "criterio no trae números, comprueba invariantes/estructura, no inventes cifras.",
      "4. `ejecutar_tests`. Para cada fallo decide con la regla de negocio si el bug está en el CÓDIGO o en " +
        "el TEST (eres dueño de ambos) y corrige el que toque; nunca debilites el test para que pase.",
      "Terminas cuando hay tests reales (que importan de src/) y TODOS pasan, con la app compilando en verde.",
    ];
    if (opts.planContext) parts.push(`\n## Plan / criterios\n${opts.planContext.slice(0, 12_000)}`);
    return parts.join("\n");
  }

  const tipo = opts.appType === "electron" ? "ESCRITORIO (Electron + SQLite)"
    : opts.appType === "mcp" ? "SERVIDOR MCP (Model Context Protocol — stdio + HTTP)"
    : opts.appType === "api" ? "SERVICIO API / integración (Fastify solo API + SQLite; sin interfaz; API key + auditoría + tareas programadas)"
    : "CLIENTE/SERVIDOR web (Fastify sirve la SPA Vue + SQLite local; Postgres en producción)";

  const scaffoldedServer =
    "El andamiaje dorado de cliente/servidor YA ESTÁ COLOCADO y ARRANCA + sirve: el servidor Fastify " +
    "(src/server.ts) sirve la SPA Vue de `web/` como estáticos y expone la API en /api/*; persistencia con " +
    "SQLite embebido (src/db.ts); rutas en src/routes.ts. Un solo proceso, un solo puerto (por eso el usuario " +
    "puede 'Probar la aplicación' sin montar nada). Trae YA, y son INFRAESTRUCTURA PERMANENTE — NO los recrees ni " +
    "los borres: (a) LOGIN obligatorio con sistema propio (src/auth/*: guard secure-by-default, sesión por cookie, " +
    "seed de admin) — toda /api nueva queda protegida automáticamente; (b) REGISTRO DE ACCESOS / auditoría " +
    "(src/audit.ts → tabla audit_log): llama a `auditar(...)` en las acciones sensibles; (c) la CÁSCARA del front en " +
    "web/src: App.vue (shell con menú lateral + cabecera + router), web/src/router.ts (rutas + guard), " +
    "web/src/components/AppSidebar.vue (menú) y web/src/views/LoginView.vue; (d) ÁREA DE ADMINISTRACIÓN solo-admin " +
    "YA hecha (gestión de usuarios + visor del registro de accesos): rutas /api/auth/usuarios|accesos en " +
    "src/auth/admin-routes.ts y vistas web/src/views/admin/*; está en el menú bajo 'Administración' (solo admin). " +
    "NO la recrees. NO recrees la estructura ni el build ni " +
    "cambies SQLite por Postgres (SQLite es local; Postgres solo en producción). Tus pasos: (1) instalar_dependencias, " +
    "(2) compilar, (3) AÑADIR el dominio real: entidades/servicios y rutas API en src/ (adaptador→aplicación→dominio) " +
    "y ELIMINAR el demo 'items' del todo (borrar_fichero src/repos/items.repo.ts; quita `items` de src/repos/index.ts, " +
    "la tabla items de src/db.ts y las rutas /api/items de src/routes.ts — y actualiza o borra cualquier test en " +
    "tests/ que quede huérfano al referenciar 'items'); y las PANTALLAS reales en web/src como VISTAS nuevas en web/src/views, " +
    "registrándolas en router.ts CON `meta.menu` (icono SVG + orden) — el MENÚ LATERAL se DERIVA del router " +
    "automáticamente, NO toques AppSidebar.vue. Reemplaza la vista placeholder web/src/views/InicioView.vue " +
    "por la primera pantalla real. NO toques App.vue (el shell) salvo para detalles de marca. La app debe seguir " +
    "ARRANCANDO, con login y sirviendo la UI; no rompas el server ni el front. " +
    "PROVEEDORES EXTERNOS (Google, Microsoft/Entra) y MFA: solo si el plan/ADR los pide — sigue library/auth/login-system.md " +
    "(emiten la MISMA cookie de sesión) y activa los botones de LoginView.vue.";

  const scaffoldedMcp =
    "El andamiaje dorado del servidor MCP YA ESTÁ COLOCADO (package.json, tsconfig NodeNext, src/server.ts " +
    "con `buildServer()`, y los transportes src/stdio.ts y src/http.ts) y compila + hace el handshake MCP. " +
    "NO lo recrees ni cambies su estructura ni los transportes. Tus pasos: (1) instalar_dependencias, (2) compilar, " +
    "(3) AÑADIR las TOOLS y RESOURCES reales del dominio DENTRO de `buildServer()` en src/server.ts (cada tool con " +
    "su `inputSchema` Zod y handler async que devuelve `{ content: [{ type: 'text', text }] }`; errores con " +
    "`isError: true`). Quita las tools de ejemplo (sumar/saludar) si no aplican. NUNCA escribas a stdout en stdio " +
    "(rompe el protocolo): logs a stderr. El objetivo es que el servidor exponga las tools/resources que pide el plan.";
  const scaffoldedElectron =
    "El andamiaje dorado YA ESTÁ COLOCADO en el proyecto (package.json, tsconfig, electron.vite.config, " +
    "src/main/index.ts, src/preload) y RENDERIZA correctamente. Trae YA una CÁSCARA del renderer que es " +
    "INFRAESTRUCTURA PERMANENTE — NO la recrees ni la borres: src/renderer/src/App.vue (shell con menú lateral + " +
    "cabecera + router), src/renderer/src/router.ts (rutas), src/renderer/src/components/AppSidebar.vue (menú) y la " +
    "vista placeholder src/renderer/src/views/InicioView.vue. (Las apps de ESCRITORIO NO llevan login ni auditoría: " +
    "son monopuesto/locales.) Trae YA persistencia con SQLite embebido (better-sqlite3, sin instalación): " +
    "src/main/db.ts (initDb, fichero en app.getPath('userData')) y src/main/repos/ (patrón repository — " +
    "items.repo.ts de ejemplo + index.ts como composition root), con su IPC de ejemplo ya cableado en " +
    "src/main/index.ts y expuesto en preload. NO cambies la estructura ni el build. Tus pasos: " +
    "(1) instalar_dependencias, (2) compilar para confirmar el verde de partida, (3) AÑADIR el dominio real: " +
    "un fichero `<entidad>.repo.ts` por entidad en src/main/repos (mismo patrón que items.repo.ts) registrado en " +
    "repos/index.ts, sus casos de uso y el IPC en src/main/index.ts para exponerlos por preload — y ELIMINAR el " +
    "demo 'items' del todo (borrar src/main/repos/items.repo.ts, quitar 'items' de repos/index.ts, la tabla items " +
    "de src/main/db.ts, los canales ipcMain.handle('items:...') de index.ts, el bloque items de preload/index.ts, " +
    "y BORRA tests/items.repo.test.ts — es un test de ejemplo SOLO sobre 'items', se queda huérfano al borrarlo); " +
    "y las PANTALLAS reales como VISTAS nuevas en src/renderer/src/views, registrándolas en router.ts CON " +
    "`meta.menu` (icono SVG + orden) — el MENÚ LATERAL se DERIVA del router automáticamente, NO toques " +
    "AppSidebar.vue. MANTÉN el renderizado y la CSP del index.html; no toques App.vue (el shell) salvo detalles de marca. " +
    "IMPORTANTE: ahora mismo la vista de inicio (views/InicioView.vue) es un PLACEHOLDER. Tu entrega NO está hecha " +
    "mientras siga el placeholder: DEBES reemplazar InicioView.vue por la primera pantalla real (y crear el resto de " +
    "vistas) de la app descrita en el plan. Compilar en verde NO es el objetivo: el objetivo es que la app MUESTRE y " +
    "haga lo que pide el plan. " +
    "DISTRIBUCIÓN: el andamiaje trae electron-builder.yml y el script 'dist' para empaquetar un instalador — " +
    "NO los borres. Sí debes poner en package.json un 'name' (en minúsculas-con-guiones) y un 'description' " +
    "acordes a la app, porque dan nombre al instalable que recibirá el usuario final.";

  const scaffoldedApi =
    "El andamiaje dorado del SERVICIO API / integración YA ESTÁ COLOCADO y ARRANCA (Fastify, src/server.ts; SQLite " +
    "embebido, src/db.ts) y compila. Es un servicio SIN interfaz: lo consumen otros sistemas. Trae YA, y son " +
    "INFRAESTRUCTURA PERMANENTE — NO los recrees: (a) autenticación por API KEY con guard secure-by-default y siembra " +
    "de clave inicial (src/auth.ts) — toda /api nueva queda protegida sola; (b) REGISTRO DE ACCESOS / auditoría " +
    "(src/audit.ts → tabla audit_log): llama a `auditar(...)` en las acciones; (c) una PÁGINA DE ESTADO pública en `/` " +
    "(para 'Probar'); (d) tareas programadas en src/jobs.ts. NO añadas interfaz/SPA/Vue (es API pura). Tus pasos: " +
    "(1) instalar_dependencias, (2) compilar, (3) AÑADIR el dominio real: endpoints en src/routes.ts (reemplaza el CRUD " +
    "de ejemplo 'items' y el webhook de ejemplo), entidades/servicios por capas, y las tareas programadas reales en " +
    "src/jobs.ts — actualiza o borra cualquier test en tests/ que quede huérfano al referenciar 'items'. Audita las " +
    "acciones sensibles. NO cambies SQLite por Postgres (SQLite es local; Postgres en producción).";

  const parts: string[] = [
    `Vas a ${opts.repair ? "REPARAR" : "CONSTRUIR"} esta aplicación. Tipo de app: **${tipo}**.`,
    opts.repair
      ? "Ya hay código en el proyecto. NO lo regeneres de cero: inspecciónalo con listar_ficheros/leer_fichero, " +
        "diagnostica y corrige. Empieza por compilar para ver el estado real."
      : opts.scaffolded
        ? (opts.appType === "mcp" ? scaffoldedMcp
          : opts.appType === "api" ? scaffoldedApi
          : opts.appType === "server" ? scaffoldedServer
          : scaffoldedElectron)
        : "Empieza SIEMPRE copiando el andamiaje dorado de este tipo de app (que ya compila), instálalo y compílalo " +
          "en verde, y solo después añade la lógica del dominio por capas.",
  ];
  if (opts.planContext) {
    parts.push(`\n## Plan de desarrollo (guíate por él, sprint a sprint)\n${opts.planContext.slice(0, 12_000)}`);
  }
  if (opts.userFeedback) {
    parts.push(`\n## Indicaciones del usuario (tenlas MUY en cuenta)\n${opts.userFeedback.slice(0, 4_000)}`);
  }
  // En la meta "app" NO se piden tests (van en su fase dedicada con presupuesto propio): aquí el objetivo
  // es la aplicación que compila y MUESTRA sus pantallas reales.
  const doneWhen = opts.scaffolded && (opts.appType === "electron" || opts.appType === "server")
    ? "Compila a menudo. NO has terminado mientras la vista de inicio (views/InicioView.vue) sea el placeholder del " +
      "andamiaje: termina cuando la app muestre las PANTALLAS REALES del plan y compile en verde. No toques la cáscara " +
      "(App.vue/router/menú) ni, en web, el login/auditoría — son permanentes."
    : "Compila a menudo. Termina cuando compile en verde.";
  parts.push("\nUsa buscar_documentacion para los criterios de aceptación y el dominio. " + doneWhen);
  return parts.join("\n");
}

/** Mensaje de continuación tras un gate en rojo: estado compacto + qué arreglar. El código está en disco. */
function buildContinuation(
  cycle: number,
  compile: { ran: boolean; ok: boolean; errors: string },
  compileErrors: number,
  vitest: VitestResult | null,
  uiPending: boolean,
  testsPending: boolean,
  opts: BuilderOptions,
  errorRepeatStreak = 0,
): string {
  const lines: string[] = [`## Estado tras el ciclo ${cycle} (verificación real del sistema)`];
  if (!compile.ran) {
    lines.push(
      "Todavía no hay nada que compile (falta el andamiaje: package.json/tsconfig). " +
        "Copia el andamiaje dorado del tipo de app con leer_plantilla, instálalo y compílalo.",
    );
  } else if (!compile.ok) {
    const insiste = errorRepeatStreak >= 2
      ? `\n\nLLEVAS ${errorRepeatStreak} CICLOS SEGUIDOS CON EXACTAMENTE EL MISMO ERROR: repetir el mismo cambio no va a ` +
        "arreglarlo. CAMBIA DE ESTRATEGIA: lee el mensaje de TypeScript LITERALMENTE (fichero y línea exactos que indica), " +
        "comprueba con leer_fichero ese punto exacto en vez de asumir, y si tu último cambio no lo arregló, REVIÉRTELO " +
        "antes de probar algo distinto. Si es un tipo/import que no encuentras, busca el contrato real con " +
        "listar_ficheros/leer_fichero en vez de inventar la firma."
      : "";
    lines.push(
      `La app NO compila: ${compileErrors} error(es). Lee los ficheros implicados, corrige y vuelve a compilar. ` +
        `Errores:\n\n${compile.errors.slice(0, 5000)}${insiste}`,
    );
  } else if (uiPending) {
    const base = opts.appType === "server" ? "web/src" : "src/renderer/src";
    const conexion = opts.appType === "server" ? "Conecta la UI con la API (fetch a /api/*)." : "Conecta la UI con el dominio/IPC vía window.api.";
    lines.push(
      `Compila ✓, PERO la vista de inicio sigue siendo el PLACEHOLDER del andamiaje (${base}/views/InicioView.vue). NO has ` +
        `terminado. Reemplaza ${base}/views/InicioView.vue por la primera pantalla real y crea el resto como vistas en ` +
        `${base}/views, registrándolas en router.ts y en el menú (AppSidebar.vue): la app debe MOSTRAR y HACER lo que pide ` +
        `el plan (dashboard, listados, formularios…). ${conexion} NO toques la cáscara (App.vue/router/menú); mantén el montaje de Vue.`,
    );
  } else if (testsPending) {
    lines.push(
      "Compila ✓, PERO faltan PRUEBAS REALES. Escribe tests Vitest en tests/ que IMPORTEN el código de la app " +
        "desde src/ (o web/src) y lo EJERCITEN de verdad — p.ej. `import { calcular } from \"../src/application/…\"` " +
        "y comprueba su resultado. PROHIBIDO reimplementar la lógica DENTRO del test y comprobar esa copia (es una " +
        "simulación: da verde sin tocar la app y puede contradecirse). Cubre cada criterio de aceptación del plan " +
        "(usa buscar_documentacion para leerlos). Los valores esperados (golden) sácalos de los EJEMPLOS de los " +
        "papers; si un criterio no trae números, comprueba invariantes/estructura, NO inventes cifras. Como eres " +
        "dueño de los tests, si un test y el código se contradicen, reconcilia ambos con la regla de negocio real.",
    );
  } else if (vitest && vitest.ran && vitest.failed > 0) {
    const fails = vitest.tests
      .filter((t) => t.status === "failed")
      .slice(0, 12)
      .map((t) => `- ✗ ${t.name}${t.message ? `\n  ${t.message.split("\n").slice(0, 3).join("\n  ")}` : ""}`)
      .join("\n");
    lines.push(`Compila ✓, pero ${vitest.failed}/${vitest.total} pruebas fallan. Lee los tests, entiende qué esperan y ajusta tu código:\n${fails}`);
  } else if (vitest && vitest.ran && vitest.total === 0) {
    lines.push("Compila ✓, pero no se ejecutó ninguna prueba. Revisa que el código a probar exista y esté exportado como esperan los tests.");
  } else {
    lines.push("Compila ✓. Ejecuta las pruebas y corrige lo que falle.");
  }
  lines.push("\nInspecciona el código actual con listar_ficheros/leer_fichero (es la fuente de verdad) y aplica las correcciones con escribir_fichero.");
  return lines.join("\n");
}

/**
 * Ejecuta el agente builder sobre el workspace `ws` hasta verde o estancamiento.
 * Cada ciclo: bucle de tools (construir/reparar) → gate determinista (compila + tests) → decisión.
 */
export async function runBuilder(cfg: AppConfig, ws: string, opts: BuilderOptions, deps: BuilderDeps = {}): Promise<BuilderResult> {
  const toolLoop = deps.toolLoop ?? runToolLoop;
  const tools = buildAgentTools(cfg, ws, opts.projectId);
  const system = deps.systemPrompt ?? await loadPrompt("builder-system");

  let lastCompile = { ran: false, ok: false, errors: "" };
  let lastErrors = 0;
  let lastVitest: VitestResult | null = null;
  let lastUiPending = false;
  let lastTestsPending = false;
  let bestMetric = Number.POSITIVE_INFINITY;
  let stall = 0;
  let lastErrorSig = "";
  let errorRepeatStreak = 0;
  let cycle = 0;
  // Presupuesto de ciclos: escala con el tamaño del plan (lo calcula el executor). Acotado por sanidad.
  const maxCycles = Math.max(3, Math.min(40, opts.maxCycles ?? MAX_GATE_CYCLES));

  for (; cycle < maxCycles; cycle++) {
    const userMsg = cycle === 0
      ? buildIntro(opts)
      : buildContinuation(cycle, lastCompile, lastErrors, lastVitest, lastUiPending, lastTestsPending, opts, errorRepeatStreak);
    const messages: ChatMessage[] = [
      { role: "system", content: system },
      { role: "user", content: userMsg },
    ];

    const loop = await toolLoop(cfg, "code", messages, tools, "builder", TOOL_ROUNDS_PER_CYCLE);
    if (!loop.supported) {
      log.warn("builder", "el modelo de rol 'code' no soporta function-calling — el agente único no puede operar");
      return {
        status: "unsupported", compiledGreen: false, compileErrors: 0, compileOutput: "",
        testsRan: false, testsFailed: 0, testsTotal: 0, cycles: cycle, uiPending: false,
      };
    }
    await opts.progress?.onCycle?.(cycle, loop.toolsUsed);

    // ── GATE determinista ──────────────────────────────────────────────────────────────────
    const compile = await typecheckApp(ws);
    lastCompile = compile;
    const compiledGreen = compile.ran && compile.ok;
    const compileErrors = compiledGreen ? 0 : compile.ran ? countTscErrors(compile.errors) : 0;
    lastErrors = compileErrors;

    // Tests: el BUILDER es dueño de ellos (los escribe e itera). Se ejecutan los que haya; deben pasar.
    const testFiles = compiledGreen ? await listTestFiles(ws) : [];
    const anyTests = testFiles.length > 0;
    let vitest: VitestResult | null = null;
    if (compiledGreen && anyTests) vitest = await runVitest(ws);
    lastVitest = vitest;

    // Si las pruebas existentes NO se pudieron ejecutar (p.ej. node_modules no instalado aún) o no había
    // ninguna, son INCONCLUSAS: no marcan rojo por sí solas (el "faltan tests" lo lleva testsPending).
    const testsInconclusive = anyTests && (!vitest || !vitest.ran || vitest.total === 0);
    const testsGreen = !anyTests || testsInconclusive
      || !!(vitest && vitest.ran && vitest.failed === 0 && vitest.total > 0);

    const buildingTests = opts.goal === "tests";
    // Andamiado con UI (escritorio o web): "hecho" exige que la UI REAL esté construida, no el
    // placeholder del andamiaje (que compila y se sirve igual). No aplica en la fase de tests (la app ya
    // está construida en su fase previa).
    const hasUi = opts.appType === "electron" || opts.appType === "server";
    const uiPending = !!(!buildingTests && opts.scaffolded && hasUi && compiledGreen
      && (await rendererIsPlaceholder(ws, opts.appType)));
    lastUiPending = uiPending;

    // Fase de TESTS: "hecho" EXIGE ≥1 test REAL (que importe de src/ y ejercite el código), no una
    // simulación que reimplemente la lógica dentro del propio test. En la fase de app no se piden tests.
    const testsPending = !!(buildingTests && compiledGreen && !(await hasRealTests(ws, testFiles)));
    lastTestsPending = testsPending;

    await opts.progress?.onGate?.(cycle, {
      compileErrors, compiledGreen, testsFailed: vitest && vitest.ran ? vitest.failed : null,
    });

    if (compiledGreen && testsGreen && !uiPending && !testsPending) {
      log.info("builder", "verde", { cycle, tools: loop.toolsUsed.length });
      return {
        status: "green", compiledGreen: true, compileErrors: 0, compileOutput: compile.errors,
        testsRan: !!vitest?.ran, testsFailed: vitest?.failed ?? 0, testsTotal: vitest?.total ?? 0, cycles: cycle + 1,
        uiPending: false,
      };
    }

    // ── Repetición de error: ¿el ciclo anterior ya vio EXACTAMENTE este mismo fallo de compilación? ──
    const errSig = compiledGreen ? "" : errorSignature(compile.errors);
    errorRepeatStreak = !compiledGreen && errSig && errSig === lastErrorSig ? errorRepeatStreak + 1 : errSig ? 1 : 0;
    lastErrorSig = errSig;

    // ── Estancamiento ──────────────────────────────────────────────────────────────────────
    // Límite distinto según la fase: en compilación el usuario NO puede ayudar (no sabe programar), así
    // que el agente insiste más antes de rendirse; en UI/tests una aclaración del usuario sí puede
    // desbloquear, así que no le hacemos esperar de más.
    const metric = gateMetric(compile.ran, compiledGreen, compileErrors, vitest, uiPending, testsPending);
    if (metric < bestMetric) { bestMetric = metric; stall = 0; } else { stall++; }
    const stallLimit = !compiledGreen ? COMPILE_STALL_LIMIT : STALL_LIMIT;
    log.info("builder", "gate en rojo", { cycle, compiledGreen, compileErrors, testsFailed: vitest?.failed ?? null, stall, stallLimit, errorRepeatStreak });
    if (stall >= stallLimit) {
      log.warn("builder", "estancado", { cycle, bestMetric, stall, stallLimit, compileErrors: lastErrors, compileOutput: compile.errors.slice(0, 3000) });
      break;
    }
  }

  return {
    status: "stalled",
    compiledGreen: lastCompile.ran && lastCompile.ok,
    compileErrors: lastErrors,
    compileOutput: lastCompile.errors,
    testsRan: !!lastVitest?.ran,
    testsFailed: lastVitest?.failed ?? 0,
    testsTotal: lastVitest?.total ?? 0,
    cycles: cycle,
    uiPending: lastUiPending,
  };
}

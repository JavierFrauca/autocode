import { promises as fs } from "node:fs";
import path from "node:path";
import type { AppConfig } from "@shared";
import { runToolLoop, type ChatMessage, type ChatTool } from "../llm/client.js";
import { buildCodeTools } from "./code-workspace.js";
import { ensureAppDeps, runVitest, typecheckApp } from "./qa-exec.js";
import { log } from "../log.js";

// Import perezoso de las capacidades de conocimiento: `tools/knowledge.ts` arrastra `db/client` →
// `better-sqlite3` (binario nativo compilado para Electron). Cargarlo solo cuando una tool de
// conocimiento se EJECUTA evita tocar ese nativo al importar el módulo (y permite testear el agente
// bajo node sin Electron). En producción se carga la primera vez que el agente busca/lee docs.
const kb = () => import("../tools/knowledge.js");

/**
 * Las "manos" del agente builder único: un solo conjunto de tools con el que LEE la documentación
 * y las plantillas (RAG), NAVEGA y EDITA el código de la app, y COMPILA / INSTALA / EJECUTA TESTS.
 *
 * Sustituye al reparto en piezas rígidas (coder, fixer, qa-exec llamados por el orquestador): aquí
 * todo está disponible para UN agente que decide cuándo traer una plantilla, escribir un fichero o
 * compilar. La verdad mecánica (compila/tests) la siguen dando `qa-exec.ts` de forma determinista;
 * estas tools solo se la exponen al modelo.
 */

/** Cuenta los errores de una salida de tsc ("Found N errors" o, en su defecto, los "error TSxxxx"). */
export function countTscErrors(output: string): number {
  if (!output) return 0;
  const m = output.match(/Found (\d+) error/i);
  if (m) return Number(m[1]);
  return (output.match(/error TS\d+/g) || []).length;
}

/** Tools de CONOCIMIENTO: papers del proyecto + biblioteca/plantillas doradas (vía RAG y por ruta). */
function buildKnowledgeTools(cfg: AppConfig, projectId: string): ChatTool[] {
  return [
    {
      name: "buscar_documentacion",
      description:
        "Busca en los DOCUMENTOS del proyecto (decisiones, reglas de negocio, pantallas, dominios…) " +
        "por significado. Úsalo para entender QUÉ hay que construir y los criterios de aceptación.",
      parameters: {
        type: "object",
        properties: {
          consulta: { type: "string", description: "Qué buscas, en lenguaje natural" },
          topK: { type: "number", description: "Cuántos fragmentos (por defecto 5)" },
        },
        required: ["consulta"],
      },
      run: async (a) => {
        const { searchDocuments } = await kb();
        const r = await searchDocuments({ query: a.consulta, projectId, topK: a.topK ?? 5 }, cfg);
        if (!r.ok) return `No se pudo buscar: ${r.error}`;
        if (r.hits.length === 0) return "(sin resultados)";
        return r.hits
          .map((h) => `### ${h.path ?? h.title ?? "(doc)"} [score ${h.score}]\n${h.text}`)
          .join("\n\n");
      },
    },
    {
      name: "buscar_biblioteca",
      description:
        "Busca por significado en la BIBLIOTECA de patrones (library/) y las PLANTILLAS de código " +
        "(templates/). Úsalo para encontrar el andamiaje dorado, los patrones (hexagonal, auth, repos) " +
        "y los fragmentos de código que debes seguir en vez de inventar.",
      parameters: {
        type: "object",
        properties: {
          consulta: { type: "string", description: "Qué patrón/plantilla buscas" },
          fuente: { type: "string", enum: ["library", "templates", "all"], description: "Dónde buscar (por defecto all)" },
          topK: { type: "number", description: "Cuántos fragmentos (por defecto 5)" },
        },
        required: ["consulta"],
      },
      run: async (a) => {
        const { searchKnowledgeBase } = await kb();
        const r = await searchKnowledgeBase({ query: a.consulta, source: a.fuente ?? "all", topK: a.topK ?? 5 }, cfg);
        if (!r.ok) return `No se pudo buscar: ${r.error}`;
        if (r.hits.length === 0) return "(sin resultados)";
        return r.hits
          .map((h) => `### ${h.source}: ${h.filePath ?? "(?)"} [score ${h.score}]\n${h.text}`)
          .join("\n\n");
      },
    },
    {
      name: "listar_plantillas",
      description:
        "Lista las rutas de TODAS las plantillas (templates/) o de toda la biblioteca (library/). " +
        "Útil para ver el catálogo del andamiaje dorado antes de leer una plantilla concreta.",
      parameters: {
        type: "object",
        properties: { fuente: { type: "string", enum: ["library", "templates"], description: "Qué catálogo listar" } },
        required: ["fuente"],
      },
      run: async (a) => {
        const { listKnowledgeBase } = await kb();
        const files = await listKnowledgeBase(a.fuente === "library" ? "library" : "templates");
        return files.length ? files.join("\n") : "(catálogo vacío)";
      },
    },
    {
      name: "leer_plantilla",
      description:
        "Devuelve el contenido COMPLETO de una plantilla por su ruta exacta dentro de templates/ o " +
        "library/ (p.ej. fuente=templates ruta=electron/tsconfig.md). Copia el andamiaje TAL CUAL.",
      parameters: {
        type: "object",
        properties: {
          fuente: { type: "string", enum: ["library", "templates"], description: "Catálogo" },
          ruta: { type: "string", description: "Ruta relativa dentro del catálogo, p.ej. server/package-json.md" },
        },
        required: ["fuente", "ruta"],
      },
      run: async (a) => {
        const { getKnowledgeBaseFile } = await kb();
        const r = await getKnowledgeBaseFile(a.fuente === "library" ? "library" : "templates", a.ruta);
        return r.ok ? (r.content ?? "") : `No se pudo leer: ${r.error}`;
      },
    },
    {
      name: "leer_maqueta",
      description:
        "Devuelve el BOCETO HTML (maqueta = 'formulario') de una pantalla. Pásale la ruta o el nombre " +
        "(p.ej. 'pantallas/login.md' o 'login'). Es el PUNTO DE PARTIDA de la pantalla: llámalo SIEMPRE " +
        "antes de construirla y reprodúcelo FIELMENTE (layout, secciones, campos, textos, estados) con " +
        "componentes Vue reales; después cablea la lógica. La maqueta manda en el LAYOUT y los CAMPOS; " +
        "el spec en prosa (buscar_documentacion) y las reglas, en la LÓGICA.",
      parameters: {
        type: "object",
        properties: {
          pantalla: { type: "string", description: "Ruta o nombre de la pantalla, p.ej. pantallas/login.md o login" },
        },
        required: ["pantalla"],
      },
      run: async (a) => {
        const { resolveProjectRoot, mockupPathFor } = await import("./mockup.js");
        let rel = String(a.pantalla ?? "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
        if (!rel) return "(indica la pantalla)";
        if (rel.toLowerCase().endsWith(".preview.html")) rel = rel.replace(/\.preview\.html$/i, ".md");
        if (!rel.toLowerCase().endsWith(".md")) rel = `${rel}.md`;
        rel = `pantallas/${rel.replace(/^pantallas\//i, "")}`;
        const previewRel = mockupPathFor(rel);
        try {
          const rootPath = await resolveProjectRoot(projectId);
          const abs = path.resolve(rootPath, previewRel);
          if (!abs.toLowerCase().startsWith(path.resolve(rootPath).toLowerCase())) return "(ruta inválida)";
          const html = await fs.readFile(abs, "utf-8");
          const clipped = html.length > 16000 ? `${html.slice(0, 16000)}\n<!-- … (recortado) -->` : html;
          return (
            `Maqueta de ${rel} — PUNTO DE PARTIDA de esta pantalla: reprodúcela FIELMENTE con los ` +
            `componentes Vue reales (layout, secciones, campos, textos, estados) y luego cablea la lógica. ` +
            `Puedes modificar lo que la regla exija, pero parte de aquí. La maqueta manda en layout/campos; ` +
            `el spec en prosa y las reglas, en la lógica:\n\n${clipped}`
          );
        } catch {
          return `(esta pantalla aún no tiene maqueta: ${previewRel}; constrúyela a partir del spec en prosa)`;
        }
      },
    },
    {
      name: "listar_pantallas",
      description:
        "Lista TODAS las pantallas del proyecto con su jerarquía: cuáles son PÁGINAS y cuáles son MODALES " +
        "(diálogos que se abren sobre una página, con su 'padre'). Llámalo AL EMPEZAR la UI: tienes que " +
        "construirlas TODAS — las páginas como vistas/rutas (con su entrada de menú si aplica) y los modales " +
        "como componentes de diálogo abiertos desde su página padre (NO como ruta ni entrada de menú).",
      parameters: { type: "object", properties: {} },
      run: async () => {
        const { resolveProjectRoot } = await import("./mockup.js");
        const { readScreenMeta, screenSlug } = await import("../screens/meta.js");
        const rootPath = await resolveProjectRoot(projectId);
        const dir = path.join(rootPath, "pantallas");
        let names: string[] = [];
        try {
          names = (await fs.readdir(dir)).filter((n) => n.toLowerCase().endsWith(".md") && !n.toLowerCase().endsWith(".fuente.md"));
        } catch {
          return "(este proyecto aún no tiene pantallas definidas en pantallas/)";
        }
        const rows: string[] = [];
        for (const name of names.sort()) {
          const rel = `pantallas/${name}`;
          let spec = "";
          try { spec = await fs.readFile(path.join(dir, name), "utf-8"); } catch { /* sigue */ }
          const meta = readScreenMeta(spec);
          const hasMockup = await fs.access(path.resolve(rootPath, rel.replace(/\.md$/i, ".preview.html"))).then(() => true).catch(() => false);
          rows.push(`- ${screenSlug(rel)} [${meta.kind}${meta.parent ? `, modal de ${meta.parent}` : ""}]${hasMockup ? " (con maqueta)" : ""}`);
        }
        return (
          "Pantallas del proyecto. Constrúyelas TODAS; para cada una llama a `leer_maqueta` y reprodúcela " +
          "fielmente. Los `modal` van como componente de diálogo de su página `padre`, no como ruta:\n" +
          rows.join("\n")
        );
      },
    },
    {
      name: "actualizar_maqueta",
      description:
        "Actualiza la MAQUETA (.preview.html) de una pantalla con el HTML que refleja lo que has construido. " +
        "Llámalo SOLO si, por un requisito del código o de las reglas, has tenido que DESVIARTE de la maqueta " +
        "original (mover/añadir/quitar algo): así la plantilla queda como reflejo fiel de lo que sale. Pásale " +
        "la pantalla y el HTML completo del boceto ya actualizado (mismo estilo/paleta que la maqueta original).",
      parameters: {
        type: "object",
        properties: {
          pantalla: { type: "string", description: "Ruta o nombre, p.ej. pantallas/login.md o login" },
          html: { type: "string", description: "HTML completo del boceto actualizado" },
        },
        required: ["pantalla", "html"],
      },
      run: async (a) => {
        const { setMockupHtml } = await import("../screens/service.js");
        let rel = String(a.pantalla ?? "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
        if (!rel) return "(indica la pantalla)";
        if (rel.toLowerCase().endsWith(".preview.html")) rel = rel.replace(/\.preview\.html$/i, ".md");
        if (!rel.toLowerCase().endsWith(".md")) rel = `${rel}.md`;
        rel = `pantallas/${rel.replace(/^pantallas\//i, "")}`;
        if (!String(a.html ?? "").trim()) return "(no me has pasado el HTML del boceto)";
        try {
          await setMockupHtml(projectId, rel, String(a.html));
          return `Maqueta de ${rel} actualizada — queda como reflejo fiel de lo construido.`;
        } catch (e: any) {
          return `(no se pudo actualizar la maqueta: ${e?.message ?? e})`;
        }
      },
    },
  ];
}

/** Tools de BUILD: instalar deps, compilar (typecheck) y ejecutar la suite de tests. Verdad mecánica. */
function buildBuildTools(ws: string): ChatTool[] {
  return [
    {
      name: "instalar_dependencias",
      description:
        "Instala las dependencias declaradas en package.json de forma aislada (Docker). Llámalo tras " +
        "crear/editar el package.json o cuando compilar diga 'Cannot find module'.",
      parameters: { type: "object", properties: {} },
      run: async () => {
        const r = await ensureAppDeps(ws, { force: true });
        return r.skipped
          ? `Sin cambios: ${r.output}`
          : `${r.ok ? "OK" : "FALLÓ"} — ${r.output.slice(-1200)}`;
      },
    },
    {
      name: "compilar",
      description:
        "Compila la app con tsc (typecheck, --noEmit). Es el GATE: devuelve si compila y, si no, el " +
        "número de errores y el detalle. Tu objetivo es dejarlo en CERO errores.",
      parameters: { type: "object", properties: {} },
      run: async () => {
        const c = await typecheckApp(ws);
        if (!c.ran) return `Compilación omitida: ${c.errors}`;
        if (c.ok) return "OK: compila sin errores (0).";
        const n = countTscErrors(c.errors);
        return `FALLA: ${n} error(es) de compilación.\n\n${c.errors.slice(0, 6000)}`;
      },
    },
    {
      name: "ejecutar_tests",
      description:
        "Ejecuta la suite de tests (vitest) en aislamiento. Devuelve cuántos pasan/fallan y el detalle " +
        "de los que fallan. Los tests son de QA y NO se pueden editar: haz que tu código los satisfaga.",
      parameters: { type: "object", properties: {} },
      run: async () => {
        const v = await runVitest(ws);
        if (!v.ran) return `No se pudieron ejecutar los tests: ${v.error ?? "error desconocido"}`;
        const head = `${v.passed}/${v.total} pasan, ${v.failed} fallan${v.sandbox === "docker" ? " (contenedor aislado)" : ""}.`;
        const fails = v.tests
          .filter((t) => t.status === "failed")
          .slice(0, 12)
          .map((t) => `- ✗ ${t.name}${t.message ? `\n  ${t.message.split("\n").slice(0, 3).join("\n  ")}` : ""}`)
          .join("\n");
        return fails ? `${head}\n\nFALLOS:\n${fails}` : head;
      },
    },
  ];
}

/** Extrae el último texto del asistente de un transcript de tool-loop (para resumir un sub-agente). */
function lastAssistantText(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === "assistant" && typeof m.content === "string" && m.content.trim()) return m.content.trim();
  }
  return "";
}

/**
 * SUB-AGENTES (fase 2 de la arquitectura): el agente builder puede delegar una subtarea ACOTADA en
 * un sub-agente con las MISMAS tools (salvo delegar de nuevo, para acotar la profundidad a 1). Sirve
 * para aislar un trozo grande y autocontenido (p.ej. "implementa el repositorio Drizzle de Pedido")
 * sin contaminar el contexto del agente principal. La verdad mecánica la sigue dando el gate del
 * builder; el sub-agente solo construye. Devuelve un resumen de lo que hizo.
 */
function buildDelegationTool(cfg: AppConfig, ws: string, projectId: string): ChatTool {
  return {
    name: "delegar_subtarea",
    description:
      "Delega una subtarea ACOTADA y bien definida en un sub-agente que tiene tus mismas tools " +
      "(leer/escribir código, compilar, buscar documentación y plantillas). Úsalo para aislar una " +
      "pieza grande y autocontenida y que no llene tu contexto. Describe el objetivo y el contexto " +
      "(ficheros/contratos que debe respetar). Devuelve un resumen; revisa luego con compilar.",
    parameters: {
      type: "object",
      properties: {
        objetivo: { type: "string", description: "Qué debe lograr el sub-agente, concreto y acotado" },
        contexto: { type: "string", description: "Ficheros, tipos o firmas que debe respetar (opcional)" },
      },
      required: ["objetivo"],
    },
    run: async (a) => {
      const sub = buildAgentTools(cfg, ws, projectId, { allowDelegation: false });
      const system =
        "Eres un sub-agente constructor ENFOCADO de AutoCode. Tienes tools para leer/escribir el código " +
        "de la app, compilar, ejecutar tests y consultar documentación y plantillas. Cumple EXCLUSIVAMENTE " +
        "la subtarea que se te encarga, respetando el código y los contratos ya existentes (léelos antes de " +
        "escribir). Compila lo que toques. Cuando termines, resume en 2-3 líneas qué ficheros creaste/cambiaste.";
      const user = `SUBTAREA:\n${a.objetivo}${a.contexto ? `\n\nCONTEXTO A RESPETAR:\n${a.contexto}` : ""}`;
      const msgs: ChatMessage[] = [{ role: "system", content: system }, { role: "user", content: user }];
      const loop = await runToolLoop(cfg, "code", msgs, sub, "builder-sub", 12);
      if (!loop.supported) return "El sub-agente no pudo operar (el modelo no soporta tools).";
      const summary = lastAssistantText(loop.messages) || "(sin resumen)";
      log.info("agent-tools", "sub-agente terminó", { tools: loop.toolsUsed.length });
      return `Sub-agente terminado. Tools usadas: ${loop.toolsUsed.length}. Resumen:\n${summary}`;
    },
  };
}

/**
 * Conjunto COMPLETO de tools del agente builder: conocimiento (RAG docs + biblioteca/plantillas),
 * workspace de código (listar/leer/escribir, acotado a `_app/` y bloqueando tests/ y node_modules/),
 * build (instalar/compilar/tests) y, salvo en sub-agentes, delegación. Es lo único que el agente
 * necesita para construir y reparar.
 */
export function buildAgentTools(
  cfg: AppConfig,
  ws: string,
  projectId: string,
  opts: { allowDelegation?: boolean } = {},
): ChatTool[] {
  const tools = [
    ...buildKnowledgeTools(cfg, projectId),
    ...buildCodeTools(ws),
    ...buildBuildTools(ws),
  ];
  // Por defecto sí permite delegar; los sub-agentes la reciben desactivada (profundidad acotada a 1).
  if (opts.allowDelegation !== false) tools.push(buildDelegationTool(cfg, ws, projectId));
  return tools;
}

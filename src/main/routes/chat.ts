import { and, asc, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { ulid } from "ulid";
import { db, schema } from "../db/client.js";
import { loadConfig } from "../config.js";
import { chatStream, runToolLoop, type ChatMessage } from "../llm/client.js";
import { enqueue } from "../agents/runner.js";
import { loadPrompt } from "../prompts.js";
import { maybeSuggestSessionTitle } from "./sessions.js";
import { buildProjectContext } from "../chat/retrieval.js";
import { buildChatTools } from "../chat/tools.js";
import { buildGovernanceChatTools } from "../tools/governance-tools.js";
import { documentSession } from "../agents/documenter.js";
import { formatScopeForChat, getProjectScope } from "../agents/scope.js";
import { log } from "../log.js";

/** ¿El mensaje del usuario es una confirmación afirmativa? (para "dar por válida" la app). */
function isAffirmative(s: string): boolean {
  const t = s.toLowerCase();
  if (/\b(no|todav[ií]a|a[úu]n no|mal|falla|fallo|error|incorrect|arregl|repar|cambia|falta|pero)\b/.test(t)) return false;
  return /\b(ok|okay|vale|s[íi]|correcto|perfecto|genial|bien|de acuerdo|conforme|aprob|validad|valida|v[áa]lida|adelante|listo|done|dale)\b/.test(t);
}

/** Convierte el error técnico del LLM en un mensaje claro para el usuario. */
function friendlyLlmError(e: any): string {
  const msg = String(e?.message ?? e);
  if (/aborted|cancel/i.test(msg)) return "La respuesta se canceló.";
  if (/ECONNREFUSED|ENOTFOUND|fetch failed|getaddrinfo|connect/i.test(msg))
    return "No pude conectar con el servidor de IA (LiteLLM/Ollama). Revisa Ajustes → Comprobar conexión.";
  if (/timeout|ETIMEDOUT/i.test(msg)) return "El modelo tardó demasiado en responder. Inténtalo otra vez.";
  if (/404|not found/i.test(msg)) return "El modelo de conversación no existe en tu servidor de IA. Revísalo en Ajustes.";
  if (/401|403|unauthor|api key|apikey/i.test(msg)) return "El servidor de IA rechazó la clave de acceso. Revísala en Ajustes.";
  if (/429|rate/i.test(msg)) return "El servidor de IA está saturado (límite de peticiones). Espera un momento.";
  return `La IA falló al responder: ${msg.slice(0, 200)}`;
}

export async function registerChatRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/chat", async (req, reply) => {
    const body = req.body as { projectId?: string; sessionId?: string; content?: string; clientMsgId?: string };
    if (!body?.projectId || !body?.sessionId || !body?.content) {
      return reply.code(400).send({ error: "faltan campos (projectId, sessionId, content)" });
    }
    const { projectId, sessionId, content } = body;
    // Idempotencia: el id del mensaje lo fija el cliente. Si la misma petición llega dos veces
    // (reintento de red), el id coincide → lo detectamos abajo y cortamos sin duplicar.
    const userMsgId = body.clientMsgId?.trim() || `msg_${ulid().toLowerCase()}`;

    // ── Abrir el stream SSE de inmediato ──────────────────────────────────────────────
    // Antes de CUALQUIER trabajo (BD/LLM) abrimos la respuesta y FORZAMOS el envío de
    // cabeceras con flushHeaders(). Así el `fetch` del cliente se resuelve al instante y
    // nunca muere por esperar cabeceras. Todo el trabajo va dentro del stream, y cualquier
    // fallo se comunica como un evento "error" claro.
    //
    // CORS A MANO (crítico): al hacer reply.hijack() el plugin @fastify/cors deja de inyectar
    // sus cabeceras, así que la respuesta SSE saldría SIN Access-Control-Allow-Origin y el
    // navegador bloquearía el stream credenciado → el fetch del cliente lanza ("no pude
    // contactar"). Replicamos aquí lo que hace el plugin (reflejar origin + credenciales).
    const reqOrigin = req.headers.origin;
    if (reqOrigin) {
      reply.raw.setHeader("access-control-allow-origin", reqOrigin);
      reply.raw.setHeader("access-control-allow-credentials", "true");
      reply.raw.setHeader("vary", "Origin");
    } else {
      reply.raw.setHeader("access-control-allow-origin", "*");
    }
    reply.raw.setHeader("content-type", "text/event-stream");
    reply.raw.setHeader("cache-control", "no-cache, no-transform");
    reply.raw.setHeader("connection", "keep-alive");
    reply.raw.setHeader("x-accel-buffering", "no");
    reply.hijack();
    try { reply.raw.flushHeaders?.(); } catch {}

    let closed = false;
    reply.raw.on("close", () => { closed = true; });

    const send = (event: string, data: any): void => {
      if (closed) return;
      try { reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { closed = true; }
    };
    const fail = (code: string, message: string): void => {
      send("error", { code, message });
      try { reply.raw.end(); } catch {}
    };

    send("open", { ts: Date.now() });

    const heartbeat = setInterval(() => {
      if (closed) { clearInterval(heartbeat); return; }
      try { reply.raw.write(":keepalive\n\n"); } catch { clearInterval(heartbeat); }
    }, 10_000);

    let full = "";
    let model = "";
    let tokensIn = 0;
    let tokensOut = 0;
    // Pantallas que el documenter ha creado/actualizado en ESTE turno: el chat las devuelve para
    // mostrar su boceto en línea ("ver las pantallas mientras se trabajan"). Fuera del try porque se
    // persiste/emite después de cerrarlo.
    const touchedScreens: string[] = [];
    try {
      // 0) Idempotencia: si ya existe un mensaje con este id, es un reenvío de la misma petición.
      //    Cortamos sin insertar nada ni volver a llamar al modelo (esto evitaba la triplicación).
      const dup = await db()
        .select({ id: schema.messages.id })
        .from(schema.messages)
        .where(eq(schema.messages.id, userMsgId))
        .limit(1);
      if (dup.length) {
        clearInterval(heartbeat);
        send("duplicate", { id: userMsgId });
        send("done", { ok: true, duplicate: true });
        try { reply.raw.end(); } catch {}
        return;
      }

      // 1) Guardar el mensaje del usuario y confirmarlo.
      await db().insert(schema.messages).values({
        id: userMsgId, projectId, sessionId, role: "user", content,
      });
      send("user", { id: userMsgId, content });

      // 2) Config + chequeo claro si la IA no está lista.
      const cfg = await loadConfig();
      const gen = cfg.generation;
      const endpointReady = gen.mode === "local" ? !!gen.baseUrl : !!gen.apiKey;
      if (!endpointReady || !gen.mainModel) {
        clearInterval(heartbeat);
        return fail(
          "not_configured",
          "La IA no está configurada. Ve a Ajustes, elige un proveedor (o tu servidor) y el modelo principal.",
        );
      }

      // 3) Contexto: historial + auto-RAG (best-effort, no rompe si falla).
      const history = await db()
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.sessionId, sessionId))
        .orderBy(asc(schema.messages.createdAt));
      const systemPrompt = await loadPrompt("chat-system");
      const baseMessages: ChatMessage[] = [{ role: "system", content: systemPrompt }];
      const ragContext = await buildProjectContext(cfg, projectId, content);
      if (ragContext) baseMessages.push({ role: "system", content: ragContext });
      // Motor de completitud: el chat conoce QUÉ piezas del alcance faltan y dirige la entrevista al
      // hueco más importante (best-effort: nunca rompe el turno si falla el cálculo). Guardamos si YA
      // estaba cerrado ANTES de este turno: es la condición para la red de seguridad de más abajo (si no
      // se pudo calcular, se trata como "abierto" — más vale una llamada de más al documenter que perder
      // en silencio lo que el usuario acaba de contar).
      let scopeWasOpenBeforeTurn = true;
      try {
        const scope = await getProjectScope(projectId);
        scopeWasOpenBeforeTurn = !scope.closed;
        baseMessages.push({ role: "system", content: formatScopeForChat(scope) });
      } catch (e) {
        log.warn("chat", "no se pudo calcular la cobertura del alcance", { err: e });
      }
      baseMessages.push(...history.map((h) => ({ role: h.role as ChatMessage["role"], content: h.content })));

      // El chat (1) CONSULTA la biblioteca y los papers para responder con criterio (p.ej. "¿qué
      // autenticación puedes usar?" → busca y contesta con lo que SÍ hay) y (2) GOBIERNA los ficheros del
      // proyecto por categoría: crear/editar/borrar decisiones, reglas, pantallas y patrones; listar/borrar
      // media; leer planes. `buildChatTools(readOnly)` deja fuera el guardar_documento genérico (lo cubren
      // las tools por categoría). Si el modelo no llama tools, runToolLoop devuelve baseMessages (sin
      // duplicar) y la respuesta se genera igual abajo; si no soporta tools, degrada solo.
      const chatTools = [
        ...buildChatTools(cfg, projectId, { readOnly: true }),
        ...buildGovernanceChatTools(cfg, projectId),
        // El documenter integrado como TOOL: extracción estructurada de decisiones/reglas/pantallas de la
        // conversación + persistencia (numera ADR/RN sin duplicar, auto-maqueta pantallas). El chat la
        // llama cuando se cierra algo que documentar (ya no corre como agente de fondo tras cada mensaje).
        {
          name: "documentar",
          description:
            "Registra como papers del proyecto las DECISIONES de arquitectura, REGLAS de negocio, el " +
            "MODELO DE DATOS (entidades de dominios/) y PANTALLAS que han quedado claras en ESTA conversación: " +
            "extrae y persiste de forma estructurada (numera ADR/RN sin duplicar y genera la maqueta de cada " +
            "pantalla nueva). Llámalo cuando se cierre algo que deba quedar documentado; devuelve qué se guardó/borró.",
          parameters: { type: "object", properties: {} },
          run: async (): Promise<string> => {
            try {
              const r = await documentSession(cfg, projectId, sessionId);
              for (const s of r.saved) {
                const base = s.replace(/\\/g, "/").split("/").pop() ?? "";
                if (s.startsWith("pantallas/") && s.toLowerCase().endsWith(".md") && !base.startsWith("_") && !touchedScreens.includes(s)) {
                  touchedScreens.push(s);
                }
              }
              return JSON.stringify({ ok: true, guardados: r.saved, borrados: r.deleted });
            } catch (e: any) {
              // El resultado de la tool lo lee el MODELO (puede acabar citándolo tal cual al usuario, que
              // no sabe programar): nunca le pasamos el mensaje técnico crudo, solo lo registramos en logs.
              log.warn("chat", "el documenter falló al guardar lo hablado en este turno", { err: e, projectId, sessionId });
              return JSON.stringify({
                ok: false,
                aviso: "No he podido guardar esto como documento del proyecto por un problema técnico puntual. Dile al usuario que no pasa nada y que lo intentarás de nuevo en el próximo mensaje; no es necesario que repita lo dicho.",
              });
            }
          },
        },
      ];
      let llmMessages: ChatMessage[] = baseMessages;
      // Tools de ESCRITURA usadas este turno (documentar + gobernanza *_guardar/*_borrar): si el bucle
      // falla entero, la dejamos vacía a propósito — no sabemos qué pasó, así que la red de seguridad de
      // abajo actúa como si no se hubiera guardado nada (más seguro que asumir que sí).
      let toolsUsedThisTurn: string[] = [];
      try {
        const loop = await runToolLoop(cfg, "chat", baseMessages, chatTools, "chat-tools");
        if (loop.supported) llmMessages = loop.messages as ChatMessage[];
        toolsUsedThisTurn = loop.toolsUsed;
      } catch (e) {
        log.warn("chat", "el bucle de tools del chat falló; respondo sin tools", { err: e });
      }

      // 4) Respuesta del modelo en streaming.
      // Empujón anti-fuga: la fase de respuesta NO lleva tools, pero algunos modelos (DeepSeek y
      // derivados), al ver el historial de tool-calls, siguen emitiéndolas como TEXTO. Le pedimos prosa.
      const streamMessages: ChatMessage[] = [
        ...llmMessages,
        {
          role: "system",
          content:
            "Ahora RESPONDE al usuario en lenguaje natural, claro y conciso. Ya has usado las herramientas " +
            "que necesitabas: NO escribas más llamadas a herramientas, ni JSON de tool-calls, ni etiquetas " +
            "tipo <｜tool…｜>, ｜｜DSML｜｜ o <invoke…> en tu respuesta.",
        },
      ];
      // Saneador en streaming: si aparece sintaxis de tool-call emitida como texto, CORTAMOS ahí (la prosa
      // previa, que sí es para el usuario, se conserva). El `GUARD` evita enviar un marcador partido entre
      // deltas. ｜ = ｜ (barra ancha de DeepSeek), ▁ = ▁.
      const TOOLCALL_RE = /｜｜|<｜|<\s*tool_calls?\b|<\s*invoke\s+name|▁tool▁call/i;
      let sent = 0;
      let cut = false;
      const GUARD = 12;
      for await (const chunk of chatStream(cfg, "chat", streamMessages, {}, "chat")) {
        if (closed) break;
        if ("delta" in chunk) {
          full += chunk.delta;
          const mi = full.search(TOOLCALL_RE);
          if (mi >= 0) {
            const clean = full.slice(0, mi).replace(/\s+$/, "");
            if (clean.length > sent) send("delta", { text: clean.slice(sent) });
            full = clean;
            cut = true;
            break;
          }
          const upto = Math.max(sent, full.length - GUARD);
          if (upto > sent) { send("delta", { text: full.slice(sent, upto) }); sent = upto; }
        } else {
          model = chunk.done.model;
          tokensIn = chunk.done.tokensIn;
          tokensOut = chunk.done.tokensOut;
        }
      }
      if (!cut && full.length > sent) send("delta", { text: full.slice(sent) });
      if (cut) {
        log.warn("chat", "respuesta recortada: el modelo emitió sintaxis de tool-call como texto");
        // Si SOLO emitió basura (sin prosa útil), guiamos al usuario al sitio correcto para crear pantallas.
        if (!full.trim()) {
          full = "Para crear varias pantallas a la vez, hazlo desde la sección **Pantallas** con **«Generar mapa con IA»** — ahí se generan todas con orden. Si prefieres, dime una pantalla concreta y la definimos.";
          send("delta", { text: full });
        }
      }

      // Red de seguridad del documenter: si había un hueco del alcance ABIERTO antes de este turno y el
      // modelo no usó NINGUNA tool de escritura (ni documentar ni gobernanza *_guardar/*_borrar), lo que
      // el usuario acaba de contar se perdería en silencio — nada más lo detectaría. Documentamos de
      // todas formas: documentSession decide por sí sola si de verdad había algo que guardar (si el turno
      // era solo un saludo, no hace nada), así no depende de que el MISMO modelo acierte dos veces. No se
      // dispara si YA se usó alguna tool de escritura (evita duplicar con lo que ya se guardó) ni una vez
      // el alcance está cerrado (evita una llamada extra en cada mensaje para siempre).
      const usoAlgunaToolDeEscritura = toolsUsedThisTurn.some((t) => t === "documentar" || /_guardar$|_borrar$/.test(t));
      if (scopeWasOpenBeforeTurn && !usoAlgunaToolDeEscritura) {
        try {
          const r = await documentSession(cfg, projectId, sessionId);
          for (const s of r.saved) {
            const base = s.replace(/\\/g, "/").split("/").pop() ?? "";
            if (s.startsWith("pantallas/") && s.toLowerCase().endsWith(".md") && !base.startsWith("_") && !touchedScreens.includes(s)) {
              touchedScreens.push(s);
            }
          }
        } catch (e) {
          log.warn("chat", "la red de seguridad del documenter también falló", { err: e, projectId, sessionId });
        }
      }
    } catch (e: any) {
      log.error("chat", "fallo durante la respuesta del chat", { err: e, projectId, sessionId });
      clearInterval(heartbeat);
      return fail("llm_error", friendlyLlmError(e));
    }
    clearInterval(heartbeat);

    // 5) Persistir SIEMPRE la respuesta (aunque el cliente se haya desconectado): así no se
    //    pierde nunca y aparece al recargar la conversación. Solo si hubo contenido real.
    const asstMsgId = `msg_${ulid().toLowerCase()}`;
    // El documenter YA NO corre como agente de fondo tras CADA mensaje: es una TOOL (`documentar`) que el
    // chat invoca durante el turno cuando se cierra algo que documentar (ver chatTools arriba) — así no se
    // duplica con las tools de gobernanza por categoría. La única excepción es la red de seguridad de
    // arriba: mientras el alcance siga abierto, si el turno no usó NINGUNA tool de escritura, se llama de
    // todas formas para no perder en silencio lo que el usuario acaba de contar.
    const runId: string | null = null;
    if (full.trim()) {
      try {
        await db().insert(schema.messages).values({
          id: asstMsgId, projectId, sessionId, role: "assistant", content: full,
          metadata: { model, tokensIn, tokensOut, ...(touchedScreens.length ? { screens: touchedScreens } : {}) },
        });
      } catch (e) {
        log.warn("chat", "no se pudo guardar la respuesta del asistente", { err: e });
      }
      maybeSuggestSessionTitle(sessionId, app.log).catch(() => {});
    }

    // 6) Cerrar lazos según el estado de la última construcción:
    //    - needs_input → ESTE mensaje es la respuesta del usuario: reintentamos la construcción.
    //    - done + pendiente de reconciliar + mensaje afirmativo → el usuario DA POR VÁLIDA la app:
    //      lanzamos la reconciliación de la documentación con lo que el código hace.
    //    (Persistimos las notas aunque el socket cierre.)
    let noticeId: string | null = null;
    let noticeText: string | null = null;
    try {
      const lastExec = (
        await db()
          .select({ status: schema.executions.status, createdAt: schema.executions.createdAt })
          .from(schema.executions)
          .where(eq(schema.executions.projectId, projectId))
          .orderBy(desc(schema.executions.createdAt))
          .limit(1)
      )[0];
      if (lastExec?.status === "needs_input") {
        // El chat NUNCA lanza la generación: solo deja registro. Tu indicación queda en la conversación y
        // el `documenter` la convierte en paper; para reintentar, relanzas TÚ desde "Generar aplicación"
        // (el executor reanuda leyendo el corpus, que ya incluye esta información).
        noticeId = `msg_${ulid().toLowerCase()}`;
        noticeText = "📝 He registrado tu indicación. Cuando quieras reintentar la construcción, ve a **Generar aplicación** y pulsa **Construir** — retomará con esta información.";
        await db().insert(schema.messages).values({
          id: noticeId, projectId, sessionId, role: "assistant", content: noticeText, metadata: { kind: "build-hint-recorded" },
        }).catch(() => {});
      } else if (lastExec?.status === "done" && isAffirmative(content)) {
        // ¿Esta versión ya se reconcilió? (algún reconciler posterior a la última construcción)
        const lastRecon = (
          await db()
            .select({ createdAt: schema.agentRuns.createdAt })
            .from(schema.agentRuns)
            .where(and(eq(schema.agentRuns.projectId, projectId), eq(schema.agentRuns.agentType, "reconciler")))
            .orderBy(desc(schema.agentRuns.createdAt))
            .limit(1)
        )[0];
        const pending = !lastRecon || String(lastRecon.createdAt) < String(lastExec.createdAt);
        if (pending) {
          // Tras el "OK": (1) escribir las PRUEBAS de aceptación que codifican lo validado, (2) reconciliar
          // la documentación con el código. Escriben ficheros distintos → pueden ir en paralelo.
          await enqueue({ projectId, sessionId, agentType: "executor", triggeredBy: "user", input: { writeTests: true } });
          await enqueue({ projectId, sessionId, agentType: "reconciler", triggeredBy: "user", input: { feedback: content } });
          noticeId = `msg_${ulid().toLowerCase()}`;
          noticeText = "✅ Gracias por validarla. Estoy creando las **pruebas de aceptación** que codifican lo que validaste y ajustando la **documentación** (papers, reglas y README) al código. Lo verás en **Generar aplicación**.";
          await db().insert(schema.messages).values({
            id: noticeId, projectId, sessionId, role: "assistant", content: noticeText, metadata: { kind: "reconcile-started" },
          }).catch(() => {});
        }
      }
    } catch (e) {
      log.warn("chat", "no se pudo evaluar el cierre de lazo (reintento/validación)", { err: e });
    }

    if (closed) return; // el socket ya está cerrado; la respuesta quedó guardada arriba

    send("assistant", { id: asstMsgId, content: full, model, tokensIn, tokensOut, documenterRunId: runId, screens: touchedScreens });
    if (noticeId && noticeText) send("notice", { id: noticeId, content: noticeText });
    send("done", { ok: true, notice: !!noticeId });
    try { reply.raw.end(); } catch {}
  });
}

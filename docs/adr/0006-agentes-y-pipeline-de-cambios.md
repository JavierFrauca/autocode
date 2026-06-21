# ADR-0006 — Agentes y pipeline de cambios

- **Estado**: **revisado** (2026-06-17) — la trazabilidad por `agent_runs` sigue; la construcción de código ya no usa el gate "propuesta→aprobar", sino un **gate determinista**
- **Fecha**: 2026-06-12 (revisado 2026-06-17)

## Contexto

Antes de **cualquier cambio** (a un paper o al código generado) queremos trazabilidad (quién lo pidió,
qué hizo el modelo), poder cancelar y reintentar, idempotencia razonable y un punto único de políticas.

## Decisión

Todo cambio pasa por un **agente** registrado en la tabla `agent_runs`. Ningún módulo escribe Markdown
ni toca la base de datos "a mano" desde la UI; siempre va por un agente.

### Tipos de agente (vigentes)

- **`documenter`**: convierte turnos de chat en propuestas de revisión de papers.
- **`planner`**: a partir de los papers, produce un plan vivo por sprints.
- **`executor`**: orquesta la construcción (fases Recolección→Análisis→Construcción→Validación→Versión)
  y registra cada paso para el túnel de la UI.
- **`builder`**: el **agente único** que construye/repara la app en un bucle de tools (ver más abajo).
- **`reindexer`**: rehace los embeddings de un proyecto entero.

> El conocimiento (búsqueda en papers) ya **no es un agente de escritura**: se sirve por RAG y por el
> MCP a partir de funciones puras (`tools/knowledge.ts`).

### Dos clases de "gate"

1. **Papers (documenter)** → gate **del usuario**: la propuesta queda en `done` y el usuario la aplica
   (`applied`) o la descarta (`discarded`). Aquí el humano es el árbitro.
2. **Código (builder)** → gate **determinista**, no opinión humana sobre un diff: el código generado se
   valida ejecutando `tsc` + tests (vitest) + render visual en escritorio (`agents/qa-exec.ts`). El
   agente VE el resultado pero no puede falsearlo. Si no llega a verde tras varios intentos, **escala a
   la persona en el chat** con el diagnóstico real. Detalle en [README §7](../../README.md#7-cómo-se-construye-la-app-el-motor).

### Ciclo de vida de un run

```
pending → running → done
                 ↘ failed     (con error_kind: llm_error|validation_error|timeout|internal)
                 ↘ cancelled  (el usuario lo paró desde la UI)
```

### Cancelación real

La cancelación **aborta la petición HTTP** en curso (vía `AsyncLocalStorage` + `AbortController` por
run, `llm/context.ts`), de modo que cancelar deja de gastar tokens de inmediato, no solo marca la fila.

### Reintentos y concurrencia

- Errores transitorios del proveedor (`5xx`, timeout, `429`) → backoff exponencial acotado.
- Errores de validación de salida del modelo → un reintento con el error como feedback; si falla, `failed`.
- Worker pool dentro del proceso Node (sin cola externa). Visor de actividad LLM en la UI con cancelar uno / cancelar la cola.

### Trazabilidad

Cada `agent_runs` guarda: `agent_type`, `project_id`, `session_id?`, `triggered_by`, `input`, `output`,
`model_role`, `model_name`, `tokens_in`, `tokens_out`, `duration_ms`, `status`, `error`, tiempos.

## Consecuencias

- Un único patrón para todo cambio → UI uniforme, logs uniformes, testing repetible.
- La verdad del código no depende de que el modelo "diga" que está bien (gate determinista).
- Pequeña sobrecarga: incluso cambios triviales pasan por un run. Aceptado.

## Historia

- **v1 (2026-06-12)**: agentes `documenter` / `builder` / `searcher` / `reindexer`, con gate
  "propuesta→aprobar/descartar" para todo cambio (incluido el código) y reintentos contra LiteLLM.
- **v2 (2026-06-17)**: la generación de código pasó de una orquestación rígida (planner→coder→qa→fixer)
  a un **agente builder único con gate determinista**; el gate de aprobación humana queda solo para los
  papers; el `searcher` se sustituyó por RAG/MCP; reintentos contra el proveedor configurado, no LiteLLM.

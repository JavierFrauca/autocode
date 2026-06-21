# ADR-0002 — Pasarela hacia los modelos LLM

- **Estado**: **revisado** (2026-06-17) — de "LiteLLM obligatoria" a "proveedores cloud directos; LiteLLM opcional"
- **Fecha**: 2026-06-12 (revisado 2026-06-17)

> ⚠️ Esta decisión cambió. El planteamiento original (LiteLLM como **único** gateway) está
> superado. Lo vigente es lo de la sección **Decisión (v2)**. La v1 se conserva en **Historia**.

## Contexto

AutoCode usa LLMs constantemente: chat, generación de código, clasificación. Las apps que genera
también pueden usar LLMs. En la decisión original se asumió que el usuario ya tenía una instancia de
**LiteLLM** desplegada, y que AutoCode hablaría solo con ella.

Dos hallazgos de 2026-06-17 invalidaron esa premisa:
1. **Solo con modelos locales no se saca el proyecto** (calidad insuficiente para el rol `code`).
2. **Pedirle a un jefe no técnico que instale y opere LiteLLM es un bloqueo** de adopción.

## Decisión (v2, vigente)

AutoCode **configura proveedores de LLM directamente**, con la **nube por defecto**. LiteLLM deja de
ser obligatoria: pasa a ser **un preset más, "En tu equipo / avanzado"** (junto a Ollama y LM Studio).

- Todos los proveedores objetivo hablan el dialecto **OpenAI-compatible**, así que el cambio fue barato:
  se pasó de una URL fija a un **registro de presets** (`src/main/llm/providers.ts`): Anthropic, OpenAI,
  DeepSeek, Qwen, Kimi, Groq, OpenRouter y `local`.
- **Dos modos**: *nube* (elegir proveedor + pegar API key → `resolveBaseUrl` usa la raíz del preset) o
  *local* (el usuario pone su propia URL OpenAI-compatible).
- Cliente HTTP: se sigue usando el **SDK de OpenAI** apuntado al `baseURL` resuelto. Es el camino más estable.
- Las **apps generadas** que usen LLM lo hacen contra el proveedor que configure cada app.
- Detalle operativo y perillas de usuario: ver [README §6](../../README.md#6-proveedores-y-modelos-de-llm)
  y [ADR-0008](0008-roles-de-modelo-llm.md).

> **Embeddings**: se desacoplan del proveedor de chat y van **siempre locales** (bge-m3 vía ONNX). Razón:
> varios proveedores no tienen API de embeddings y los que la tienen difieren en dimensión (cambiar de
> proveedor forzaría reindexar Qdrant). Ver [ADR-0003](0003-postgres-qdrant-y-multi-proyecto.md) y [ADR-0008](0008-roles-de-modelo-llm.md).

## Consecuencias

- El usuario no técnico arranca sin instalar nada: elige proveedor, pega su key y va.
- AutoCode sí gestiona la API key del proveedor (en su config local), a cambio de quitar el bloqueo de LiteLLM.
- Se conserva el caso privacidad/offline casi gratis vía el preset local.
- El rol `code` exige un modelo con **function-calling** (lo usa el agente builder); se comprueba al conectar.

## Historia

- **v1 (2026-06-12)**: LiteLLM como **único** gateway. La config era una sola URL + API key de LiteLLM;
  los roles de modelo eran etiquetas que LiteLLM enrutaba; AutoCode nunca llamaba a proveedores
  directamente. Se descartó al concluir que (a) lo local no basta y (b) exigir LiteLLM bloquea al
  usuario objetivo. La migración de config vieja→nueva es automática (`migrateLegacy` en `config.ts`):
  la LiteLLM del usuario se conserva como preset "local".

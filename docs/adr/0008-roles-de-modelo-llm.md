# ADR-0008 — Roles de modelo LLM

- **Estado**: **revisado** (2026-06-17) — siguen los roles internos, pero de cara al usuario son 2 perillas y los embeddings son locales fijos
- **Fecha**: 2026-06-12 (revisado 2026-06-17)

## Contexto

AutoCode necesita varias capacidades LLM con perfiles diferentes (conversar, generar código,
documentar, embeddings, tareas baratas). Acoplar el código a un `model_name` concreto en cada sitio
es frágil; un solo modelo para todo es caro o malo. La abstracción **por rol** sigue siendo válida.

Lo que cambió en 2026-06-17 ([ADR-0002 v2](0002-litellm-como-unico-gateway-llm.md)): ya no hay una
LiteLLM con N `model_name`; hay un **proveedor** (nube o local) y los embeddings son **locales**.

## Decisión (v2, vigente)

El código sigue pidiendo **por rol**, no por modelo. Hay **cinco roles internos**:

| Rol | Uso | Alimentado por |
|---|---|---|
| `chat` | Diálogo con el usuario | **Modelo principal** |
| `code` | Agente builder que genera la app objetivo (el más potente; **requiere function-calling**) | **Modelo principal** |
| `docs` | Agente documenter que mantiene los papers | **Modelo principal** |
| `cheap` | Routing, clasificación, títulos, resúmenes cortos | **Modelo rápido** |
| `embeddings` | Ingesta y búsqueda en Qdrant | **Local fijo** (bge-m3 @1024, ONNX) |

### Dos perillas de cara al usuario

Los cinco roles se colapsan en **dos decisiones** del usuario (ver [README §6](../../README.md#6-proveedores-y-modelos-de-llm)):

- **Modelo principal** → roles `chat`, `code`, `docs`.
- **Modelo rápido** → rol `cheap`.

El mapeo vive en `modelFor` (`src/main/llm/client.ts`): `cheap` → `fastModel`; el resto → `mainModel`.

### Embeddings: locales, no configurables

- Modelo y dimensión **fijos**: `bge-m3` a `1024` (`EMBEDDINGS_MODEL` / `EMBEDDINGS_DIM` en `@shared`).
- Corren **en proceso** vía ONNX (`@huggingface/transformers`), descargados al primer arranque.
- Razón: desacoplarlos del proveedor de chat evita reindexar Qdrant al cambiar de proveedor
  ([ADR-0002 v2](0002-litellm-como-unico-gateway-llm.md)). La dimensión fija mantiene válidas las
  colecciones existentes sin reindexar.

### Cómo se usa en código

- `chat(role, messages, options?)` recibe el rol; `embed(texts)` usa siempre el embedder local.
- Cambiar el modelo principal/rápido no toca código de aplicación.
- Un agente puede registrar su `model_role`/`model_name` en `agent_runs` para trazabilidad.

## Consecuencias

- Código desacoplado de proveedores y nombres de modelo.
- El usuario tiene **dos** decisiones, no una por rol ni una por llamada.
- Sumar un sexto rol (p. ej. `vision`) sigue siendo trivial.
- El usuario ya **no decide nada de embeddings** (ni modelo ni dimensión): menos fricción, cero reindex.

## Historia

- **v1 (2026-06-12)**: **cuatro** roles (`chat`, `code`, `embeddings`, `cheap`), todos configurados
  como `model_name` contra una única LiteLLM, con `dim` de embeddings declarada por el usuario. Después
  se añadió el rol `docs` (el `cheap` devolvía papers pobres) → cinco roles. En 2026-06-17, con el giro
  a proveedores directos ([ADR-0002](0002-litellm-como-unico-gateway-llm.md)), los cinco roles se
  colapsaron en dos perillas y los embeddings pasaron a locales fijos.

# AutoCode

> Un "Claude Code" para jefes que no saben programar.
> El usuario describe **reglas de negocio** en lenguaje natural; AutoCode mantiene
> **documentación viva** en Markdown y genera **aplicaciones llave en mano**.

> **Estado: prototipo / alfa funcional.** El motor de generación está implementado y verificado
> (offline + un par de demos en vivo, p. ej. un editor SEPA real). Falta validarlo de punta a
> punta por la UI sobre proyectos reales complejos. Ver [Estado del proyecto](#9-estado-del-proyecto).

---

## 1. Qué es

AutoCode es una **aplicación de escritorio local, monopuesto y autocontenida** que conversa con un
**product owner / jefe no técnico**, captura sus requisitos en lenguaje natural y los convierte en:

1. **Documentación viva** en Markdown (papers versionados) que es la **única fuente de verdad** del
   proyecto.
2. **Aplicaciones generadas** sobre un stack cerrado, entregadas listas para usar.

El usuario nunca ve código mientras conversa. Ve chat, documentos renderizados (con **galería de
pantallas** y **«Modificar con IA»** sobre cada boceto), búsqueda semántica sobre lo que ha ido
decidiendo, una pestaña **Ejecutar** para probar y distribuir la app, y al final un artefacto ejecutable.

> **Importante:** Docker es solo para **las apps que AutoCode genera** (y, opcionalmente, para aislar
> sus pruebas). **AutoCode en sí NO necesita Docker** ni servidores externos.

## 2. Para quién

- **Product owners** y **jefes de proyecto** que tienen claro **qué** quieren pero no **cómo**.
- Equipos pequeños que necesitan prototipos funcionales rápidos.
- Desarrolladores que quieran un acelerador de andamiaje + dominio (hoy, el público donde mejor encaja).

**No es para**: programadores que quieren autocompletado, ni para casos donde la arquitectura es el
problema. Aquí la arquitectura está cerrada a propósito.

## 3. Stack

### Stack de AutoCode (la herramienta)

Proyecto **npm** único gestionado con **electron-vite**. Un solo `npm run dev` abre toda la app.

- **Frontend (renderer)**: Vue 3 + TypeScript + Vite + Pinia.
- **Backend**: **Fastify embebido dentro del proceso main de Electron** (no es un proceso aparte),
  escuchando en `127.0.0.1:4317`.
- **Escritorio**: Electron.
- **Persistencia**: **SQLite** (`better-sqlite3` + Drizzle ORM). Fichero en `%APPDATA%/AutoCode/autocode.db`.
  No hay Postgres.
- **Búsqueda semántica + embeddings**: **Nucleus**, un motor RAG propio escrito en Rust, embebido
  **in-process como DLL** (`vendor/nucleus/nucleus.dll`, vía **koffi** en un `worker_thread` —
  `src/main/nucleus/`). En una sola pieza hace almacenamiento (redb), **embeddings**
  (`multilingual-e5-small`, 384d, en proceso) y **búsqueda híbrida vector + BM25**: **sin servidor, sin
  puerto, sin sidecar**. BBDD en `C:\ProgramData\AutoCode\nucleus.redb`; el modelo se descarga solo la
  primera vez. **Un dominio por proyecto.** El usuario no configura nada de búsqueda ni embeddings.
- **LLM de generación**: el usuario **conecta un proveedor directamente** (ver [§6](#6-proveedores-y-modelos-de-llm)).

```
src/
  main/       ← Electron main + Fastify embebido + agentes + acceso a datos
    nucleus/  ← cliente del motor RAG (DLL) + worker_thread + indexado diferido
  preload/    ← contextBridge (window.api)
  renderer/   ← Vue 3 (UI)
  shared/     ← tipos TypeScript compartidos
prompts/      ← system prompts (Markdown)
templates/    ← andamiajes "dorados" y plantillas de código
library/      ← biblioteca de patrones reutilizables
vendor/       ← nucleus.dll (motor RAG in-process; se reparte con el instalador)
```

### Stack de las apps que AutoCode **genera**

AutoCode sabe generar **tres tipos** de aplicación (el tipo se deriva de un ADR de arquitectura por proyecto):

| Tipo | Stack | Entrega |
|---|---|---|
| **Escritorio** (`electron`) | Electron + Vue 3 + SQLite local | App de escritorio |
| **Servidor / web** (`server`) | Fastify + Postgres + Vue, con Docker | Docker Compose llave en mano |
| **Servidor MCP** (`mcp`) | `@modelcontextprotocol/sdk` + Zod, transportes stdio y HTTP | Servidor MCP |

## 4. Modelo conceptual

```
   Usuario (NL) ──► Chat ──► Agente "documenter" ──► Markdown (papers vivos)
                              │                          │
                              ▼                          ▼
                          SQLite                     Nucleus (semántica)
                                                         │
                                                         ▼
                                       Agente "planner" (plan vivo por sprints)
                                                         │
                                                         ▼
                                       Agente "builder" (bucle de tools + gate)
                                                         │
                                                         ▼
                                                  App generada
```

- **Todo el chat** se persiste en SQLite.
- **Cada turno relevante** dispara al agente *documenter*, que crea/modifica papers Markdown.
- **Cada cambio de Markdown** se reindexa en Nucleus para búsqueda semántica (RAG).
- La app se construye desde los papers vigentes mediante el **agente builder** (ver [§7](#7-cómo-se-construye-la-app-el-motor)).

Detalle (algunos ADR están parcialmente desfasados, ver [§10](#10-estado-de-los-adr)):
[ADR-0004](docs/adr/0004-markdown-como-fuente-de-verdad.md),
[ADR-0005](docs/adr/0005-chat-vs-documentos-vivos.md).

## 5. Multi-proyecto

Un usuario gestiona **N proyectos** simultáneos. Cada uno tiene:
- Una **carpeta raíz** en disco (la que elija el usuario) con sus papers Markdown.
- Su estado indexado en SQLite por `project_id`.
- Un **dominio Nucleus propio** (`proj:<id>`) por aislamiento real de la búsqueda.

## 6. Proveedores y modelos de LLM

AutoCode habla el dialecto **OpenAI-compatible**, así que conecta proveedores **directamente** —
**LiteLLM ya no es obligatoria** (es solo un preset "local / avanzado"). Hay **dos modos**:

- **En la nube (recomendado)**: eliges proveedor y pegas tu **API key**. Nada más: los **modelos van
  PRESELECCIONADOS** por proveedor (`defaultMain`/`defaultFast` en `src/main/llm/providers.ts` — el único
  punto de mantenimiento cuando un proveedor saca modelo nuevo). Un **«Avanzado»** plegado permite
  cambiarlos. Proveedores: **Anthropic, OpenAI, DeepSeek, Qwen, Kimi (Moonshot), Groq, OpenRouter**.
- **En tu equipo (local / avanzado)**: pones tu propia URL OpenAI-compatible
  (**Ollama / LM Studio / LiteLLM**) y ahí sí eliges los modelos ("traer modelos" vía `GET /v1/models`).

Internamente solo hay **dos modelos**:

| Modelo | Alimenta |
|---|---|
| **Principal** | los roles internos `chat`, `code` y `docs` |
| **Rápido** | el rol interno `cheap` (títulos, clasificación, resúmenes cortos) |

Los **embeddings** ya no son un rol configurable: los hace **Nucleus** en local (`multilingual-e5-small`).

> ⚠️ El **modelo principal debe soportar function-calling (tool-calling)**: el agente builder lo
> EXIGE. AutoCode lo comprueba al conectar.

## 7. Cómo se construye la app (el motor)

La generación NO es una orquestación rígida, sino **un solo agente builder en bucle de tools**
(`src/main/agents/builder.ts`), con tres ideas centrales:

- **Andamiaje dorado determinista**: antes de tocar al LLM, el *programa* copia un andamiaje
  conocido-bueno (`templates/electron-app/`, `templates/mcp-server/`, etc.) que **ya compila y
  renderiza**. El agente solo construye **encima**. Así los fallos estructurales (pantalla en blanco,
  build roto, CSP) son imposibles por construcción.
- **Gate determinista que el modelo ve pero no puede falsear** (`src/main/agents/qa-exec.ts`):
  compila con `tsc`, ejecuta los tests con vitest y, en escritorio, **verifica que renderiza de
  verdad** (captura un screenshot, no pantalla en blanco). La métrica de progreso ordena fases
  (no-compila ≫ UI-placeholder ≫ tests-rojos ≫ verde) y detecta estancamiento.
- **La memoria es el sistema de ficheros**: cada ciclo arranca con contexto limpio y el agente relee
  el disco con sus tools → contexto acotado.

Si el agente se atasca, **escala a la persona en el chat** con el diagnóstico real, y responder en el
chat reanuda la construcción.

### Máquina del tiempo (versiones)

Cada vez que una construcción pasa el gate, se guarda una **versión que funciona** mediante un **git
oculto** dentro de `_app` (`src/main/git/repo.ts`). El usuario nunca ve jerga git: ve "versiones que
funcionan" y "volver atrás" (revert no destructivo). Usa el git del sistema si existe; en Windows,
si no hay, **descarga MinGit portátil a `userData` la primera vez** (sin instalar nada, sin admin), así
el instalador no carga el binario.

### Distribución (apps de escritorio)

Una app que compila no sirve de nada si el usuario final no sabe construirla. Por eso, para las apps
de escritorio, AutoCode prepara un **instalador** repartible bajo demanda (botón "Preparar instalador"
en la pestaña *Ejecutar*). El agente **packager** (`src/main/agents/packager.ts`) instala las
dependencias, construye con electron-vite y empaqueta con **electron-builder** un **instalador NSIS
(`.exe`)** que el destinatario instala con doble clic (crea acceso directo y desinstalador). El nombre
del proyecto da nombre al instalable. El andamiaje trae la config (`templates/electron-app/electron-builder.yml`
+ el script `dist`), y `runPackage` (`src/main/agents/qa-exec.ts`) deja el `.exe` en `_app/release/`,
que se abre en el explorador para copiarlo y repartirlo. Es bajo demanda porque electron-builder tarda
minutos y baja ~100 MB la primera vez.

## 8. Configuración mínima del usuario

Al abrir AutoCode por primera vez (pantalla de Ajustes → "Servidor de IA"):

1. **Carpeta raíz** donde vivirán los proyectos.
2. **Modo nube**: proveedor + API key (los modelos ya vienen preseleccionados).
   **Modo local**: URL OpenAI-compatible + modelos.

No se pide ni Postgres, ni URL de búsqueda, ni nada de embeddings: SQLite y **Nucleus** (su BBDD en
`C:\ProgramData\AutoCode` y su modelo de embeddings) se gestionan solos. A partir de aquí, **todo lo
demás es conversación**.

## 9. Estado del proyecto

Prototipo / alfa funcional. Implementado y verificado: el motor de agente único, el gate determinista,
el andamiaje dorado, la verificación visual, la máquina del tiempo, los proveedores cloud y el **motor
RAG Nucleus** (búsqueda + embeddings in-process por DLL; `npm test` en verde + smoke end-to-end de
ingest/búsqueda). **Pendiente**: validar "Generar app" de punta a punta por la UI sobre proyectos reales
complejos (lo probado en vivo son tareas acotadas + una demo SEPA real).

## 10. Estado de los ADR

Las decisiones de arquitectura están en [`docs/adr/`](docs/adr/). Tras los cambios de rumbo de 2026-06,
los ADR afectados se **revisaron in situ** (cada uno con una sección **Historia** que conserva la
decisión original). Estado actual:

| ADR | Estado |
|---|---|
| [0001 — Stack cerrado Vue/Node](docs/adr/0001-stack-cerrado-vue-node.md) | Vigente |
| [0002 — Pasarela hacia los modelos LLM](docs/adr/0002-litellm-como-unico-gateway-llm.md) | **Revisado (v2)** → proveedores cloud directos; LiteLLM = preset local. Ver [§6](#6-proveedores-y-modelos-de-llm) |
| [0003 — SQLite + búsqueda local, multi-proyecto](docs/adr/0003-postgres-qdrant-y-multi-proyecto.md) | **Revisado** → SQLite + **Nucleus** (motor RAG propio en Rust, embebido por DLL) reemplaza a Qdrant y a los embeddings `bge-m3`; un dominio por proyecto. Ver [§3](#3-stack) |
| [0004 — Markdown como fuente de verdad](docs/adr/0004-markdown-como-fuente-de-verdad.md) | Vigente |
| [0005 — Chat vs documentos vivos](docs/adr/0005-chat-vs-documentos-vivos.md) | Vigente |
| [0006 — Agentes y pipeline de cambios](docs/adr/0006-agentes-y-pipeline-de-cambios.md) | **Revisado (v2)** → agente builder único + gate determinista. Ver [§7](#7-cómo-se-construye-la-app-el-motor) |
| [0007 — Arquitectura Electron única](docs/adr/0007-arquitectura-electron-unica.md) | Vigente (fusiona y reemplaza al ADR-0007 "dos formatos", ya eliminado: AutoCode es solo monopuesto) |
| [0008 — Roles de modelo LLM](docs/adr/0008-roles-de-modelo-llm.md) | **Revisado (v2)** → 5 roles internos → 2 perillas; embeddings locales fijos. Ver [§6](#6-proveedores-y-modelos-de-llm) |
| [0009 — Galería de patrones](docs/adr/0009-galeria-de-patrones.md) | Vigente |

> El [`docs/PLAN.md`](docs/PLAN.md) (plan por sprints) es el roadmap **original** y está parcialmente
> superado; lleva un banner de estado al principio que apunta a lo vigente.

## 11. Cómo arrancar

### Requisitos

- **Node 20** o superior.
- **npm** (este repo se gestiona con npm — hay `package-lock.json`. Ignora el `pnpm-lock.yaml` viejo;
  correr `pnpm` rompe el árbol de `node_modules`).
- Una API key de un proveedor de LLM (modo nube) **o** un endpoint local OpenAI-compatible.

AutoCode **no** necesita Docker, Postgres ni ningún servidor de búsqueda: SQLite embebido
(`%APPDATA%/AutoCode/`) y **Nucleus** in-process por DLL (BBDD + modelo en `C:\ProgramData\AutoCode/`,
descargado solo la primera vez).

### Desarrollo

```bash
npm install
npm run dev      # abre Electron + Vite + Fastify embebido, todo en uno
```

Al abrir la app por primera vez: pantalla de Ajustes → conecta tu proveedor de IA y elige una carpeta
raíz para tus proyectos. Luego crea un proyecto y conversa.

### Otros comandos

```bash
npm run build    # build de producción (electron-vite)
npm run package  # empaqueta el instalador (electron-builder)
npm test         # tests (vitest sobre src/main/__tests__)
npm run lint     # biome
```

### Biblioteca de patrones

Desde la barra superior puedes acceder a la **Biblioteca / Patrones** — una galería compartida entre
proyectos con piezas reutilizables (auth, CQRS, listados, etc.) que el agente builder consulta.
Ver [ADR-0009](docs/adr/0009-galeria-de-patrones.md).

### Sample

`samples/inventario/` contiene un proyecto de ejemplo. Sigue [su README](samples/inventario/README.md).

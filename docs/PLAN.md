# Plan general — AutoCode

> ⚠️ **Estado (2026-06-17): este es el plan ORIGINAL (junio 2026) y está parcialmente superado.**
> Se conserva como registro histórico del roadmap, pero varias premisas cambiaron. Para el estado real
> ver el [README](../README.md) y el [Estado de los ADR](../README.md#10-estado-de-los-adr). En concreto:
> - **Stack de AutoCode**: no es monorepo pnpm con `apps/api`+`apps/web`+Postgres+docker-compose. Es un
>   **proyecto npm único** (electron-vite) con **Fastify embebido** y **SQLite** ([ADR-0007](adr/0007-arquitectura-electron-unica.md), [ADR-0003](adr/0003-postgres-qdrant-y-multi-proyecto.md)).
> - **LLM**: no es "LiteLLM obligatoria"; son **proveedores cloud directos** ([ADR-0002](adr/0002-litellm-como-unico-gateway-llm.md)) y **embeddings locales** ([ADR-0008](adr/0008-roles-de-modelo-llm.md)).
> - **Sprint 5 (generador)**: el "blueprint + scaffolding" se sustituyó por un **agente builder único con
>   gate determinista** ([ADR-0006](adr/0006-agentes-y-pipeline-de-cambios.md), [README §7](../README.md#7-cómo-se-construye-la-app-el-motor)). AutoCode genera 3 tipos de app: escritorio, servidor/web y MCP.
> - **Sprint 6 (modo cliente-servidor de AutoCode)**: **descartado** — AutoCode es solo monopuesto ([ADR-0007](adr/0007-arquitectura-electron-unica.md)). (El modo cliente-servidor con Docker es de las apps GENERADAS, no de AutoCode.)

Plan por sprints. El **goal** es llegar a una versión presentable que **cree aplicaciones reales** de extremo a extremo.

Cada sprint es una unidad demostrable. No saltamos sprints; cada uno deja la herramienta en un estado en el que el usuario puede usarla de verdad para algo, aunque sea poco.

---

## Sprint 0 — Fundaciones

**Objetivo**: tener un esqueleto Electron + Node corriendo en local, con Postgres y Qdrant disponibles y la configuración de LiteLLM lista.

Entregables:
- Monorepo (pnpm workspaces) con paquetes `apps/desktop` (Electron), `apps/api` (Node), `packages/shared` (tipos compartidos), `packages/ui` (componentes Vue).
- Electron arranca y muestra una pantalla de **bienvenida + configuración**.
- Configuración persistida en disco: `litellmBaseUrl`, `litellmApiKey`, modelos por rol (`chat`, `code`, `embeddings`, `cheap`), `projectsRoot`.
- `docker-compose.dev.yml` con Postgres + Qdrant para desarrollo.
- Esquema Postgres inicial: `projects`, `sessions`, `messages`, `documents`, `document_revisions`, `agent_runs`. Todas con `project_id`.
- Health-check de LiteLLM y Qdrant desde la UI (semáforo verde/rojo).
- Test de humo: crear un proyecto vacío, comprobar que aparece su fila en `projects` y su colección en Qdrant.

**Demo**: el usuario abre AutoCode, configura sus datos, crea un proyecto. Aún no conversa.

---

## Sprint 1 — Chat y persistencia

**Objetivo**: el usuario habla con AutoCode y todo queda guardado.

Entregables:
- Vista de chat estilo Claude Code (lista de mensajes + caja de entrada + streaming de respuesta).
- Selector de proyecto en la barra superior.
- Cliente OpenAI-compatible contra LiteLLM (rol `chat`).
- Persistencia completa de la conversación en Postgres (sin pérdida; ni siquiera mensajes de error).
- Historial cronológico navegable.
- Tests de integración: un chat de N turnos se recupera intacto tras reiniciar.

**Demo**: el usuario mantiene una conversación, cierra la app, la abre, y la conversación sigue.

---

## Sprint 2 — Documentos vivos (Markdown)

**Objetivo**: convertir la conversación en papers técnicos versionados.

Entregables:
- Agente **documentador**: tras cada turno (o lote), decide si crear un Markdown nuevo o modificar uno existente, y lo escribe en la carpeta del proyecto.
- Convenciones de nombrado y front-matter de los papers (ver glosario y ADR-0004).
- Tabla `documents` + `document_revisions` (cada cambio queda versionado).
- Vista de documentos: árbol lateral + renderizado bonito (Markdown + Mermaid + bloques de código).
- Diff entre revisiones.
- Confirmación del usuario antes de aplicar el cambio propuesto por el agente (gate).

**Demo**: el usuario describe un módulo de "gestión de clientes"; AutoCode genera/actualiza papers y los muestra renderizados con su historial.

---

## Sprint 3 — Qdrant y búsqueda semántica

**Objetivo**: que el usuario y los futuros agentes puedan buscar lo ya hablado.

Entregables:
- Cliente embeddings (rol `embeddings`) contra LiteLLM.
- Ingesta automática: cada revisión de Markdown se chunkea, embebe e indexa en la colección Qdrant del proyecto.
- Buscador semántico en la UI: el usuario pregunta en lenguaje natural y obtiene respuesta con **citas** a los papers correspondientes.
- Re-indexado completo de un proyecto bajo demanda.
- Métricas básicas: nº de chunks, dimensión, último indexado.

**Demo**: el usuario pregunta "¿qué decidimos sobre los descuentos?" y recibe la respuesta apoyada en los papers donde lo dijo.

---

## Sprint 4 — Pipeline de agentes

**Objetivo**: cualquier cambio (regla o código) pasa por un agente ejecutor con trazabilidad.

Entregables:
- Cola de cambios (tabla `agent_runs`: `pending → running → done/failed`).
- Agente **ejecutor** genérico que orquesta: leer contexto (Qdrant + Postgres), pedir al modelo, validar, aplicar.
- Logs visibles en la UI: qué agente, qué input, qué output, cuánto tardó, cuánto costó.
- Cancelación de un run en curso.
- Reintentos con backoff en errores transitorios de LiteLLM.

**Demo**: el usuario modifica una regla; en la UI ve al agente arrancar, leer contexto, proponer el cambio y aplicarlo.

---

## Sprint 5 — Generador de apps cliente

**Objetivo**: a partir de los Markdown, AutoCode produce una **app real desplegable**.

Entregables:
- Agente **constructor**: lee todos los Markdown vigentes de un proyecto, sintetiza un blueprint y genera el scaffolding completo de la app objetivo (Vue + Node + esquema Postgres).
- Templates base de la app objetivo (mismo stack que AutoCode).
- Salida en una subcarpeta `build/` del proyecto.
- Fichero de despliegue: `Dockerfile` + `docker-compose.yml` para cliente-servidor, o configuración Electron para escritorio.
- "Smoke run" automático: arrancar la app generada y comprobar que levanta sin errores.

**Demo**: el usuario pulsa "construir" y obtiene una app que arranca en `localhost:3000` con su modelo de datos y sus pantallas básicas.

---

## Sprint 6 — Modo cliente-servidor de AutoCode

**Objetivo**: separar la API y la UI de la propia herramienta para uso multiusuario.

Entregables:
- `apps/api` expone HTTP REST (mismo dominio que el embebido en Electron).
- `apps/web` (Vue) consume la misma API.
- Autenticación básica (usuarios + sesiones).
- Despliegue: `Dockerfile` para API + estático para web.
- Modo "embedded" (Electron) y modo "remote" (web contra API) comparten 100% del código de UI.

**Demo**: dos usuarios distintos trabajan en el mismo proyecto desde navegadores diferentes.

---

## Sprint 7 — Cross-project search

**Objetivo**: aprovechar que tenemos muchos proyectos para reutilizar conocimiento.

Entregables:
- Buscador con selector de proyectos: "solo este", "todos los míos", "selección".
- Búsqueda multi-colección en Qdrant.
- Resultados marcados con su proyecto de origen y enlace al paper.
- Permisos: un usuario solo busca en proyectos a los que pertenece.

**Demo**: el usuario consulta "cómo gestionamos descuentos" y ve resultados de tres proyectos suyos con citas.

---

## Sprint 8 — Empaquetado y presentación

**Objetivo**: dejarlo presentable.

Entregables:
- Electron compilado para Windows (instalador) y opcionalmente macOS/Linux.
- `docker-compose.prod.yml` para el modo cliente-servidor.
- README con `getting started` real (no placeholder).
- Vídeo/demo guiada: caso de uso end-to-end (un jefe describe una app y obtiene la app desplegada).
- Sample project que viene con la instalación.

**Demo**: la presentación final. Instalas AutoCode, abres el sample, generas una app, la lanzas.

---

## Criterios transversales (todos los sprints)

- **Tests**: cada sprint añade tests de integración para sus features. Sin tests no se cierra.
- **Errores de LiteLLM**: cualquier fallo de modelo se muestra al usuario de forma legible, nunca traza cruda.
- **Persistencia primero**: no se hace nada en memoria que no se pueda recuperar tras reiniciar.
- **No bloquear la UI**: trabajos largos (constructor, ingesta) van a la cola de agentes con feedback de progreso.
- **Multi-proyecto desde el día uno**: `project_id` en todas las tablas desde Sprint 0.

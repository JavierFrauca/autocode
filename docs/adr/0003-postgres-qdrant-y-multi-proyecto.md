# ADR-0003 — SQLite + Qdrant local, multi-proyecto desde el día uno

- **Estado**: aceptado
- **Fecha**: 2026-06-12 (revisado 2026-06-13: Postgres → SQLite tras decidir que AutoCode es una app de escritorio autocontenida; ver sección "Historia" abajo)

## Contexto

AutoCode es una app **de escritorio**, autocontenida: el usuario hace doble clic y funciona. No puede depender de que el usuario tenga Postgres, Docker ni servicios externos.

Necesitamos:
- Persistencia transaccional (chats, documentos, versiones, agentes).
- Búsqueda semántica sobre los Markdown de cada proyecto.
- Aislamiento entre proyectos por defecto.
- Posibilidad futura de buscar cruzando varios proyectos.

## Decisión

### SQLite como persistencia transaccional

- Un fichero `autocode.db` por instalación, en `%APPDATA%/AutoCode/` (Windows) o equivalente.
- Driver: **better-sqlite3** (sincrónico, prebuilt binaries; rápido y simple). Acceso a alto nivel vía **Drizzle ORM** dialecto SQLite.
- Pragmas al abrir: `journal_mode=WAL` y `foreign_keys=ON`.
- Todas las tablas que dependen de un proyecto llevan `project_id NOT NULL` indexado.
- Tablas clave: `projects`, `users`, `project_members`, `sessions`, `messages`, `documents`, `document_revisions`, `agent_runs`, `embeddings_index`, `app_config`.
- Soft-delete (`deleted_at`) en proyectos, usuarios y documentos.
- Migraciones gestionadas con Drizzle Kit; el primer arranque ejecuta `ensureSchema()` idempotente.

### Qdrant local (binario)

- Distribuimos el binario oficial de Qdrant junto con la app, o lo descargamos al primer arranque a `%APPDATA%/AutoCode/qdrant/`.
- Electron lo arranca como proceso hijo escuchando en `127.0.0.1:6333` y lo mata al cerrar la ventana.
- **Una colección por proyecto**, llamada `project_{uuid}`.
- Razones para la colección-por-proyecto:
  - Aislamiento real: borrar/reindexar un proyecto no toca a los demás.
  - Permisos triviales: si no puedes ver el proyecto, no apuntamos a su colección.
  - Las búsquedas cross-project son una multi-collection search nativa de Qdrant.
- El payload de cada punto incluye: `document_id`, `revision_id`, `chunk_index`, `path`, `heading_path`, `text`, `created_at`.
- El modelo de embeddings y su dimensión son **fijos y locales** (`bge-m3` @ `1024`, ONNX en proceso), no configurables por el usuario; se validan al crear la colección y al ingestar. Ver [ADR-0008](0008-roles-de-modelo-llm.md) (revisado 2026-06-17). *(En v2 de este ADR los fijaba el rol `embeddings` contra LiteLLM.)*

### Cross-project search

- Opt-in y explícito por consulta. La API toma `projectIds: string[]` y hace búsqueda paralela sobre las colecciones permitidas, fusionando resultados por score.
- Requiere que todas las colecciones implicadas usen la **misma dimensión de embeddings**. Si no, error claro.

## Consecuencias

- **Cero instalación de DB**: el `.db` aparece al primer arranque.
- **Cero dependencias externas en producción**: SQLite y Qdrant viajan con la app.
- Más colecciones que gestionar (una por proyecto). Aceptable; Qdrant lo lleva bien.
- Cambiar el modelo de embeddings global obliga a reindexar todos los proyectos (agente `reindexer`). *(En la práctica ya no ocurre: el modelo de embeddings es fijo, precisamente para no reindexar al cambiar de proveedor de chat — ver [ADR-0002](0002-litellm-como-unico-gateway-llm.md) y [ADR-0008](0008-roles-de-modelo-llm.md).)*
- SQLite es single-writer: para esta app (un usuario, un proceso) no es un problema; si algún día hay modo cliente-servidor se reabre.

## Alternativas descartadas

- **PostgreSQL embebido (postgres-portable)**: pesado, lío de empaquetado en Windows, sobreproducto para single-user.
- **Solo Postgres en Docker** (versión inicial de este ADR): rompía la promesa "doble clic y va".
- **Pgvector o sqlite-vec en vez de Qdrant**: pgvector reintroduce Postgres; sqlite-vec es prometedor pero queremos rendimiento y snapshots independientes por proyecto.
- **Colección Qdrant única con filtro `payload.project_id`**: peor aislamiento, riesgo de fugas si fallamos un filtro.

## Historia

- v1 (2026-06-12): Postgres + Qdrant vía docker-compose. Se descartó tras realinear el alcance: AutoCode es **app de escritorio**, no servicio.
- v2 (2026-06-13): SQLite local + Qdrant binario local. Versión vigente.

# ADR-0009 — Galería global de patrones reutilizables

- **Estado**: aceptado
- **Fecha**: 2026-06-13

## Contexto

Mientras un usuario va creando varios proyectos con AutoCode, hay piezas que se repiten: una pantalla de autenticación, un módulo CQRS, un listado paginado, una decisión de arquitectura concreta. Reescribirlas cada vez es desperdicio, y el LLM no tiene memoria entre proyectos.

A la vez, el ADR-0003 cierra que cada proyecto está aislado en su carpeta y su colección Qdrant. Cualquier compartición tiene que ser **explícita** y **fuera** del eje proyecto.

## Decisión

Una **galería global** de **patrones** dentro de la instalación de AutoCode (no es por proyecto):

### Modelo

- Tabla `patterns` en SQLite: `id`, `name`, `description`, `tags`, `body` (Markdown), `source_project_id` (opcional), `created_at`, `updated_at`, `deleted_at`.
- Colección Qdrant dedicada: `__autocode_patterns__`. Se asegura al arrancar / al guardar config / al primer insert.
- Cada patrón se chunkea (igual que los papers) y se indexa con `payload.pattern_id`.

### Operaciones

- **Crear**: el usuario puede crear un patrón manualmente desde la UI, o aceptarlo de una propuesta del curador.
- **Buscar**: búsqueda semántica desde la UI ("autenticación", "paginación", "CQRS").
- **Importar**: copiar un patrón a un proyecto crea un paper en `patrones/<slug>.md`, lo registra en `documents`/`document_revisions` y lo ingiere en la colección Qdrant del proyecto. A partir de ahí es un paper más, el builder lo verá.
- **Borrar**: soft delete en SQLite + borrar puntos por filtro en Qdrant.

### Agentes

- **`patternCurator`** (nuevo). Input: `{ projectId, hint? }`. Lee los papers vigentes y el último blueprint del builder; propone hasta 3 patrones candidatos. `requiresGate = true`. Al aplicar, inserta cada patrón en la galería.
- No introducimos un `patternApplier` en v1: importar = copiar el Markdown al proyecto. Cuando haga falta adaptación (renombrar entidades, ajustar nombres del cliente) se abrirá otro ADR.

### UI

- Acceso global desde la barra superior: **Patrones**. Lista, búsqueda semántica, vista detallada con Markdown renderizado, importar a proyecto, crear manual, borrar.
- Acceso desde el proyecto: en **Construir**, botón "Proponer patrones" que encola el curator. La propuesta se gestiona desde **Agentes** como cualquier otra (gate del usuario).

### Por qué una colección Qdrant separada

- **Aislamiento**: no se mezcla con los puntos de los proyectos del usuario.
- **Permisos triviales** (cuando algún día haya modo multiusuario): la galería puede tener su propia política.
- **Mismo embedding dim**: requiere coincidir con la dimensión configurada en el rol `embeddings`. Si el usuario cambia el modelo de embeddings, hay que reindexar la galería (igual que los proyectos).

## Consecuencias

- Mejora directa de la productividad: lo que se curra una vez sirve siempre.
- Coste extra mínimo: una colección Qdrant y una tabla SQLite.
- Riesgo de "ruido": patrones mal cuidados ensucian la galería. Se mitiga con el gate del usuario (nunca se guarda nada sin que apruebe) y el criterio explícito del prompt del curator ("si no encuentras nada con valor reutilizable real, devuelve `[]`").

## Alternativas descartadas

- **Patrones como papers especiales dentro de un "proyecto galería"**: forzaba meter una galería como proyecto, rompía el modelo `project_id` y el aislamiento.
- **Patrones a nivel de fichero (filesystem)**: el usuario querría buscarlos semánticamente, y eso requiere Qdrant; ya que vamos a indexar, mejor también en SQLite por consistencia.
- **Compartición pública entre usuarios**: fuera de alcance. La galería es local a la instalación; en el futuro puede haber un canal para publicar/importar.

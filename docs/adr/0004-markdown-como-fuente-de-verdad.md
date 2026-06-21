# ADR-0004 — Markdown como fuente de verdad

- **Estado**: aceptado
- **Fecha**: 2026-06-12

## Contexto

El usuario describe el sistema en lenguaje natural. Necesitamos un formato persistente que:
- Sea legible por humanos sin herramientas especiales.
- Se versione de forma trivial (texto plano).
- Sirva tanto como input para los agentes generadores como output para el usuario.
- Se renderice bonito en la UI.

## Decisión

Cada proyecto vive como un árbol de **Markdown** dentro de la carpeta raíz que el usuario elige. Estos Markdown son la **única fuente de verdad** del proyecto. Postgres guarda metadatos y revisiones; Qdrant guarda embeddings; el código generado se deriva de los Markdown. Nunca al revés.

### Formato de un paper

- Extensión `.md`.
- Front-matter YAML obligatorio:
  ```yaml
  ---
  id: doc_<ulid>
  title: "Gestión de clientes"
  tags: [dominio, clientes]
  status: draft | active | deprecated
  created_at: 2026-06-12T10:00:00Z
  updated_at: 2026-06-12T10:00:00Z
  ---
  ```
- Cuerpo: Markdown estándar (CommonMark + GFM) con extensiones permitidas:
  - Bloques Mermaid (`mermaid`) para diagramas.
  - Bloques de código.
  - Tablas, listas, enlaces relativos a otros papers.
- Una sola convención de títulos: `#` para el título del paper (= `title` del front-matter), `##` para secciones, etc.

### Estructura de carpetas dentro de un proyecto

```
<projectRoot>/
├── _autocode/             # estado interno de AutoCode (no tocar a mano)
│   ├── project.json       # id del proyecto, versión del esquema
│   └── ingest.state.json  # último estado de ingesta a Qdrant
├── README.md              # overview generado del proyecto
├── decisiones/            # decisiones de negocio
├── dominio/               # entidades y reglas
├── pantallas/             # UX/UI deseada por el usuario
├── flujos/                # flujos de usuario
└── build/                 # app generada (no se versiona como paper)
```

La carpeta concreta donde cae cada paper la decide el agente documentador a partir de `tags`/contenido; el usuario puede mover papers a mano si quiere — el agente respeta su ubicación posterior.

### Versionado

- En disco vive **siempre** la última revisión activa.
- Cada cambio aplicado se guarda en `document_revisions` (id, doc_id, autor, diff o contenido completo, timestamp, comentario opcional).
- El diff entre revisiones es visible en la UI.

### Renderizado en UI

- Vue + `markdown-it` (+ plugins front-matter, anchors, footnote, attrs, container).
- Mermaid renderizado lado cliente.
- Bloques de código resaltados con Shiki.

## Consecuencias

- El proyecto es **portable**: el usuario puede zippear la carpeta y llevársela; abriéndola en otra AutoCode se reconstruye el estado (reindexando Qdrant a partir de los `.md`).
- Git, `diff`, búsqueda con grep externos funcionan sin que hagamos nada especial.
- Romper la consistencia Markdown ↔ Postgres ↔ Qdrant es posible si alguien edita a mano y AutoCode no detecta el cambio. Mitigación: watcher de filesystem + reconciliación al abrir el proyecto.

## Alternativas descartadas

- **JSON / YAML estructurado** como formato canónico: peor de leer, peor de editar a mano, mata el "renderizado bonito".
- **Base de datos como fuente de verdad** y exportar Markdown: pierde portabilidad y el usuario no puede hacer copia de seguridad copiando una carpeta.

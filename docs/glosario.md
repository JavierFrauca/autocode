# Glosario

Términos que usamos dentro de AutoCode. Si un término no está aquí, no lo usamos.

## Proyecto
Unidad de trabajo del usuario. Tiene un `project_id`, una carpeta raíz en disco con sus papers, una colección Qdrant propia y sus filas en Postgres.

## Paper (o documento)
Fichero Markdown dentro de la carpeta del proyecto que recoge una parcela de las reglas de negocio (p. ej. "gestión de clientes", "reglas de descuentos", "menú principal"). Es la **fuente de verdad**. El código generado se deriva de los papers, no al revés.

## Revisión
Cada versión histórica de un paper. Se guarda íntegra en `document_revisions`; el paper actual en disco es la última revisión aplicada.

## Sesión
Una conversación continua del usuario dentro de un proyecto. Un proyecto tiene muchas sesiones.

## Mensaje (turno)
Cada intervención (`role: user|assistant|system|tool`) dentro de una sesión. Se persisten todos sin excepción.

## Agente
Proceso autónomo que ejecuta una tarea contra un modelo LLM. Tipos previstos:
- **Documentador** — del chat al Markdown.
- **Ejecutor** — gate antes de aplicar cualquier cambio.
- **Constructor** — de los Markdown a la app generada.
- **Buscador** — convierte preguntas en consultas Qdrant + síntesis.

Cada ejecución se registra en `agent_runs`.

## Agent run
Una invocación concreta de un agente: input, output, modelo usado, tokens, duración, estado (`pending|running|done|failed|cancelled`).

## Rol de modelo
Etiqueta lógica (`chat`, `code`, `embeddings`, `cheap`) que el código usa para pedir un LLM sin acoplarse a un proveedor concreto. La configuración mapea cada rol a un `model_name` de LiteLLM.

## LiteLLM
Pasarela OpenAI-compatible que el usuario despliega y mantiene fuera de AutoCode. AutoCode habla **solo** con LiteLLM ([ADR-0002](adr/0002-litellm-como-unico-gateway-llm.md)).

## Stack cerrado
Conjunto fijo de tecnologías que ni AutoCode ni el usuario pueden cambiar para las apps generadas: Vue + Node + Postgres + Qdrant opcional + LiteLLM. Reduce decisiones a tomar y permite plantillas robustas.

## App generada (o app objetivo)
La aplicación que AutoCode produce a partir de los papers de un proyecto. No confundir con la propia AutoCode.

## Carpeta raíz (del proyecto)
Directorio en disco donde viven los papers de un proyecto. La elige el usuario en la configuración. AutoCode no la mueve nunca; solo escribe dentro.

## Cross-project search
Búsqueda semántica que abarca varias colecciones Qdrant a la vez. Opt-in por consulta ([ADR-0003](adr/0003-postgres-qdrant-y-multi-proyecto.md)).

## Patrón
Trozo reutilizable de una solución (una pantalla tipo, un módulo, una decisión arquitectónica) guardado en la **galería global** de AutoCode. No pertenece a ningún proyecto concreto. Se importa como paper en `patrones/` dentro de cualquier proyecto. Ver [ADR-0009](adr/0009-galeria-de-patrones.md).

## Galería de patrones
Colección global de patrones, compartida entre todos los proyectos del instalador. Persistida en SQLite (`patterns`) e indexada en una colección Qdrant dedicada (`__autocode_patterns__`).

## Curador de patrones
Agente (`patternCurator`) que examina los papers de un proyecto y propone patrones candidatos para guardar en la galería. Siempre con gate del usuario.

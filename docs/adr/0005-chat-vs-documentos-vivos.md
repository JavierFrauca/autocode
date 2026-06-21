# ADR-0005 — Dos vistas del conocimiento: chat cronológico + documentos vivos

- **Estado**: aceptado
- **Fecha**: 2026-06-12

## Contexto

El usuario habla. Si solo guardamos los Markdown, perdemos el "porqué" y el camino que llevó hasta cada decisión. Si solo guardamos el chat, los Markdown se vuelven un derivado constante y el usuario nunca tiene la verdad consolidada delante.

Necesitamos ambas vistas, y reglas claras sobre qué es autoritativo.

## Decisión

Mantenemos en paralelo:

### 1. Chat cronológico (historia)
- **Todo** lo que escribe el usuario y todo lo que responde la herramienta se persiste íntegro en `messages`.
- Es inmutable: ni el usuario ni un agente editan mensajes pasados.
- Sirve para auditoría ("¿cómo llegamos a esto?"), para entender contexto y para reproducir agentes en el futuro.

### 2. Documentos vivos (verdad actual)
- Los Markdown ([ADR-0004](0004-markdown-como-fuente-de-verdad.md)) reflejan **el estado actual** de las decisiones.
- Cambian con el tiempo, con historial completo en `document_revisions`.
- Son la entrada del agente constructor para generar la app.

### Quién mueve qué

- El usuario habla → entra en el chat.
- El agente **documentador** se dispara tras turnos relevantes (heurística + clasificador `cheap`): decide si crear o modificar uno o varios papers.
- **Antes de aplicar**, propone el cambio (diff) al usuario. El usuario aprueba, rechaza o edita.
- Aplicado el cambio, se reindexa la parte afectada en Qdrant.

### Reglas de autoridad

- **Si chat y documento se contradicen, manda el documento.** El chat es histórico; el documento es la decisión consolidada.
- El usuario puede pedir explícitamente "vuelve a lo que decía antes" → el agente busca en el historial y propone una nueva revisión del paper, no edita silenciosamente.

## Consecuencias

- Auditoría total sin perder usabilidad: el usuario consulta papers, pero siempre puede preguntar "¿por qué pone esto?" y obtener el turno de chat que lo originó (lo trackeamos con `message_id` en `document_revisions`).
- El agente documentador es un punto crítico: si falla, el proyecto se desincroniza. Mitigación: dry-run, gate al usuario, posibilidad de regenerar un paper desde su historia.
- Más almacenamiento que un sistema de una sola vista. Asumido.

## Alternativas descartadas

- **Solo chat, regenerar papers bajo demanda**: el usuario nunca tiene una vista estable y el constructor depende de regenerar todo cada vez.
- **Solo papers, sin chat**: imposible explicar el "porqué" y mata la idea de búsqueda semántica sobre la conversación.

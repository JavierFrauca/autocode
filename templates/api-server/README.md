# Servicio API / integración

Un servicio **sin interfaz**: lo consumen otros sistemas (apps, webhooks, integraciones), no personas.
Fastify + SQLite embebido, autenticado por **API key**, con **registro de accesos** y **tareas programadas**.

## Arrancar en local

```bash
npm install
npm run build
PORT=3000 API_KEY=mi-clave-secreta node dist/server.js
```

Abre `http://localhost:3000/` para ver la página de estado. La API vive en `/api/*`.

## Autenticación

Todas las rutas `/api/*` (salvo `/api/health`) exigen la API key:

```bash
curl -H "Authorization: Bearer mi-clave-secreta" http://localhost:3000/api/items
curl -X POST -H "Authorization: Bearer mi-clave-secreta" -H "content-type: application/json" \
  -d '{"nombre":"prueba"}' http://localhost:3000/api/items
```

(También se acepta la cabecera `X-API-Key: mi-clave-secreta`.) Las claves se guardan **hasheadas** en la
tabla `api_keys` y pueden revocarse (`activo = 0`).

## Qué incluye

- `src/server.ts` — arranque, página de estado, health, guard global.
- `src/auth.ts` — guard por API key + siembra de la clave inicial.
- `src/audit.ts` (+ tabla `audit_log`) — registro de accesos.
- `src/routes.ts` — CRUD de ejemplo + receptor de webhook.
- `src/jobs.ts` — tarea programada de ejemplo (`setInterval`; usa `node-cron` para horarios).
- `src/db.ts` — SQLite (api_keys, audit_log, items).

## Producción

Entrega como **paquete de despliegue** (Docker): `docker compose up -d --build`. Variables: `PORT`,
`DB_FILE`, `API_KEY`. Para alta concurrencia, migra la capa de datos a PostgreSQL (mismo modelo).

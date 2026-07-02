# Aplicación cliente/servidor

App web multiusuario: un solo proceso Fastify sirve la SPA de Vue (`web/`) como estáticos y expone la API
en `/api/*`, con SQLite embebido. Login propio obligatorio (correo + contraseña) y registro de accesos
desde el primer día — no son opcionales en una app compartida.

## Arrancar en local

```bash
npm install
npm run build
SEED_ADMIN_PASSWORD=cambia-esto PORT=3000 node dist/server.js
```

Abre `http://localhost:3000/`. Entra con `admin@example.com` y la contraseña de `SEED_ADMIN_PASSWORD`
(en desarrollo, si no la fijas, usa `cambia-esto-1234`).

## Qué incluye

- `src/server.ts` — arranque: estáticos, guard global, rutas.
- `src/auth/` — login con cookie httpOnly (`routes.ts`), guard *secure-by-default* (`guard.ts`), siembra
  del admin inicial (`seed.ts`), área de administración — usuarios + registro de accesos (`admin-routes.ts`).
- `src/audit.ts` (+ tabla `audit_log`) — registro de accesos.
- `src/security.ts` — cabeceras de seguridad + límite de peticiones (sin dependencias extra).
- `src/repos/` — patrón *repository* (`items` de ejemplo; `usuarios`/`accesos` para auth).
- `src/db.ts` — SQLite (usuarios, audit_log, items).
- `web/` — SPA de Vue: `App.vue` (cáscara con menú lateral, deriva del router), `router.ts` (añade
  pantallas aquí con `meta.menu`), `views/LoginView.vue`, `views/admin/*` (administración).

## Producción

`PORT`, `DB_FILE` y `AUTH_SECRET` por variables de entorno; detrás de un proxy con TLS. Para más de una
réplica, migra la capa de datos (`src/repos/`) a PostgreSQL — el resto de la app no cambia.

# Endurecimiento web (cabeceras, rate-limit, CORS)

**Categoría:** seguridad | **Cuándo usar:** toda app web/servicio expuesto. **Ya viene en el andamiaje**
(`server-app` y `api-server`, fichero `src/security.ts`), sin dependencias. NO lo recrees; aquí está qué
hace y cómo ajustarlo.

## Qué incluye (versión ligera, sin deps)

- **Cabeceras de seguridad** (`registrarCabecerasSeguridad`): `X-Content-Type-Options: nosniff`,
  `X-Frame-Options` (SAMEORIGIN en web; DENY en api), `Referrer-Policy: no-referrer`, etc. Equivalente
  ligero a `helmet`.
- **Rate-limit por IP** (`registrarRateLimit`): ventana fija en memoria sobre `/api/*` (por defecto 300
  req/min/IP → `429` al pasarse). Frena abuso y fuerza bruta de login. Es por proceso.
- **CORS** (solo `api-server`, `registrarCors`): lista blanca de orígenes de navegador desde
  `ALLOWED_ORIGINS` (coma-separados); maneja el preflight `OPTIONS`. Vacío = sin CORS (consumo
  servidor-a-servidor no lo necesita).

```ts
// Ajuste típico en server.ts (ya cableado): endurece el login con un límite más estricto
registrarRateLimit(app, { ventanaMs: 60_000, max: 300 });
```

## Cuándo subir a las librerías "de verdad"

Cambia a `@fastify/helmet`, `@fastify/rate-limit` (con store Redis si hay varias réplicas) y `@fastify/cors`
si necesitas: **CSP** completa y configurable, rate-limit **distribuido** (varias instancias), o CORS con
reglas finas por ruta. El andamiaje ligero cubre el caso monoinstancia interno; estas libs, el caso a escala.

## Otras medidas (ya en el andamiaje o en su biblioteca)

- Login: cookie httpOnly firmada + comparación timing-safe + seed admin (`library/auth/login-system.md`).
- Secretos por entorno y validación al arrancar: `library/seguridad/config-env.md`.
- Registro de accesos / auditoría: `library/seguridad/audit-log.md` (visor admin ya incluido en web).
- Cifrado en reposo de datos sensibles: `library/seguridad/cifrado-reposo.md`.

Detrás de un proxy: termina TLS en el proxy y pasa `X-Forwarded-For` (el rate-limit y la auditoría ya lo leen).

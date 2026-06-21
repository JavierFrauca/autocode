# Andamiaje Servidor — estructura dorada (Fastify + Vue + Drizzle + Docker)

**tags:** server, servidor, fastify, vue, drizzle, postgres, docker, typescript, andamiaje, scaffold
**transversal:** true
**Cuándo usar:** SIEMPRE que el tipo de app sea **servidor (web/multiusuario)**. Copia el andamiaje TAL CUAL para arrancar en verde, y solo después añades la lógica.

## Qué aporta este andamiaje (vs lo que ya hay)
Las plantillas `templates/api/*` (handlers, rutas, repos), `templates/infra/*` (Dockerfile, compose) y la guía `library/arquitectura/hexagonal-estructura.md` ya cubren la **lógica y los patrones**. Lo que faltaba —y rompía siempre— era lo **estructural**: `package.json` con todas las deps, `tsconfig.json` correcto y la entrada `server.ts` ensamblada. Eso es lo que añaden estas plantillas (`package-json.md`, `tsconfig.md`, `server-entry.md`).

## Estructura de carpetas OBLIGATORIA
```
.
├── package.json                 ← ver plantilla server/package-json
├── tsconfig.json                ← ver plantilla server/tsconfig (Node, SIN dom)
├── Dockerfile                   ← templates/infra/Dockerfile
├── docker-compose.yml           ← templates/infra/docker-compose (Postgres)
├── drizzle.config.ts            ← config de migraciones
├── src/
│   ├── server.ts                ← entrada: Fastify + CORS + rutas + listen  (server-entry.md)
│   ├── domain/                  ← entidades, puertos, errores (sin frameworks)
│   │   ├── entities/
│   │   └── ports/
│   ├── application/             ← commands/queries + handlers  (templates/api/command-handler, query-handler)
│   ├── infrastructure/
│   │   └── db/
│   │       ├── schema.ts        ← Drizzle schema
│   │       └── DrizzleXxxRepository.ts  (templates/api/repository-postgres)
│   └── adapters/
│       └── http/
│           ├── index.ts         ← registerRoutes(app): registra TODAS las rutas
│           └── xxx.routes.ts    ← rutas Fastify  (templates/api/fastify-crud-routes)
└── tests/                       ← propiedad de QA
```

## Hexagonal (la guía completa)
Ver `library/arquitectura/hexagonal-estructura.md` — es exactamente esta estructura. Recordatorio de capas: `adapters/http` (rutas, solo traducen + Zod) → `application` (handlers) → `domain` (entidades+puertos) ; `infrastructure` implementa los puertos. **Seguridad**: toda app servidor incluye en Sprint 1 el guard global + matriz de roles (`library/auth/roles-middleware.md`).

## Cómo arrancar (el agente)
1. Copia `package.json`, `tsconfig.json`, `Dockerfile`, `docker-compose.yml`, y `src/server.ts` + `src/adapters/http/index.ts` (con un `/health`).
2. **Compila YA** (verde antes de meter lógica).
3. Por cada caso de uso del plan: entidad/puerto en `domain/`, handler en `application/`, repo Drizzle en `infrastructure/`, ruta en `adapters/http/` (registrada en `index.ts`).

Persistencia: **Postgres + Drizzle** para multiusuario (`library/persistencia/postgres-drizzle.md`). Para un servidor simple/embebido, vale `better-sqlite3` (misma estructura, solo cambia el driver).

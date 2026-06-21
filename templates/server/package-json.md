# Template: package.json para Servidor (Fastify + Drizzle)

**tags:** server, package.json, fastify, drizzle, deps, scripts, vitest
**transversal:** true
**Cuándo usar:** raíz de toda app servidor. Cópialo y ajusta `name`/`description`. NO inventes deps ni scripts.

`package.json`:
```json
{
  "name": "mi-servidor",
  "version": "1.0.0",
  "description": "API de servidor",
  "type": "module",
  "main": "dist/server.js",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate"
  },
  "dependencies": {
    "fastify": "^5.1.0",
    "@fastify/cors": "^10.0.1",
    "@fastify/cookie": "^11.0.1",
    "drizzle-orm": "^0.36.4",
    "postgres": "^3.4.5",
    "zod": "^3.23.8",
    "bcryptjs": "^2.4.3",
    "ulid": "^2.3.0"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "tsx": "^4.19.0",
    "vitest": "^2.1.5",
    "drizzle-kit": "^0.28.1",
    "@types/node": "^22.9.0",
    "@types/bcryptjs": "^2.4.6"
  }
}
```

## Notas
- `"type": "module"` + `tsconfig` NodeNext → imports CON extensión `.js` (p.ej. `from "./adapters/http/index.js"`). Es obligatorio con NodeNext.
- **Postgres** vía driver `postgres` + `drizzle-orm/postgres-js`. Para servidor simple/embebido: cambia a `better-sqlite3` + `drizzle-orm/better-sqlite3` (quita `postgres`, añade `better-sqlite3` y `@types/better-sqlite3`).
- `bcryptjs` para hashing de contraseñas (apps con login). Si no hay auth, quítalo.
- `tsx` para `dev` (ejecuta TS sin compilar). El gate de QA usa `tsc --noEmit` (typecheck) y `vitest`.
- Si la app sirve un frontend Vue, ese va en su propio sub-proyecto Vite (ver `templates/web/*`) o servido como estáticos.

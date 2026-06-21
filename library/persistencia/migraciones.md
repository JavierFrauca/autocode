# Migraciones y datos iniciales (Drizzle)

**Categoría:** persistencia | **Cuándo usar:** SIEMPRE que haya base de datos. El esquema evoluciona; nunca cambies la BD a mano en producción.

## Concepto
El esquema vive en `infrastructure/db/schema.ts` (Drizzle). Cada cambio genera una **migración** (SQL versionado) que se aplica de forma reproducible. Los **seeds** cargan datos iniciales (roles, catálogos, un usuario admin).

## Flujo de trabajo
1. Cambias `schema.ts` (añades tabla/columna).
2. `npx drizzle-kit generate` → crea un fichero SQL en `drizzle/`.
3. `npx drizzle-kit migrate` (o el runner programático de abajo) → aplica lo pendiente.
4. **Commitea el SQL generado**: la migración es parte del código, no un artefacto.

## drizzle.config.ts
```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/infrastructure/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql", // o "sqlite"
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

## Aplicar migraciones al arrancar (Postgres)
```typescript
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

export async function runMigrations(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  await pool.end();
}
```

Variante SQLite (monopuesto / Electron):
```typescript
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

export function runMigrations(): void {
  const sqlite = new Database(process.env.DB_PATH ?? "data.db");
  migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
  sqlite.close();
}
```

## Seed idempotente
```typescript
// src/infrastructure/db/seed.ts
import { db, schema } from "./client.js";

export async function seed(): Promise<void> {
  // onConflictDoNothing → ejecutar el seed muchas veces NO duplica.
  await db()
    .insert(schema.roles)
    .values([
      { id: "admin", nombre: "Administrador" },
      { id: "user", nombre: "Usuario" },
    ])
    .onConflictDoNothing();
}
```

## Reglas
- **Nunca** `drop`+`create` en producción: pierde datos. Solo migraciones aditivas y seguras.
- El SQL generado **se commitea**: es la historia reproducible del esquema.
- Seeds **idempotentes** (`onConflictDoNothing` / upsert): re-ejecutables sin daño.
- En monopuesto (SQLite), aplica las migraciones al abrir la app, antes de servir nada.

Andamiaje listo: `templates/api/migraciones-seed`.

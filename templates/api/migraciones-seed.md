# Template: Migraciones y seed (Drizzle)

**tags:** drizzle, migraciones, seed, postgres, sqlite
**transversal:** true

Copia los tres ficheros. Genera migraciones con `npx drizzle-kit generate` y aplícalas al arrancar (llama a `runMigrations()` antes de `app.listen`).

```typescript
// drizzle.config.ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/infrastructure/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

```typescript
// src/infrastructure/db/migrate.ts
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

export async function runMigrations(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  await pool.end();
}
```

```typescript
// src/infrastructure/db/seed.ts
import { db, schema } from "./client.js";

export async function seed(): Promise<void> {
  await db()
    .insert(schema.roles)
    .values([
      { id: "admin", nombre: "Administrador" },
      { id: "user", nombre: "Usuario" },
    ])
    .onConflictDoNothing();
}
```

Dependencias (Postgres): `npm install pg` y `npm install -D @types/pg drizzle-kit`.
Para SQLite, usa `drizzle-orm/better-sqlite3/migrator` (ver `library/persistencia/migraciones`).

# SQLite con Drizzle ORM — Clase base CRUD

**Categoría:** persistencia | **Cuándo usar:** Aplicaciones de escritorio (Electron), monopuesto, sin concurrencia alta

## Setup

```typescript
// db/client.ts
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

let _db: ReturnType<typeof drizzle> | null = null;

export function db() {
  if (!_db) {
    const sqlite = new Database(process.env.DB_PATH ?? "app.db");
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    _db = drizzle(sqlite, { schema });
  }
  return _db;
}
```

## Esquema ejemplo

```typescript
// db/schema.ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const clientes = sqliteTable("clientes", {
  id: text("id").primaryKey(),
  nombre: text("nombre").notNull(),
  email: text("email").notNull().unique(),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});
```

## CRUD base

```typescript
import { eq, isNull } from "drizzle-orm";
import { ulid } from "ulid";

export class ClienteRepo {
  async findAll() {
    return db().select().from(schema.clientes);
  }

  async findById(id: string) {
    const rows = await db().select().from(schema.clientes).where(eq(schema.clientes.id, id));
    return rows[0] ?? null;
  }

  async create(data: { nombre: string; email: string }) {
    const id = ulid().toLowerCase();
    const inserted = await db().insert(schema.clientes).values({ id, ...data }).returning();
    return inserted[0]!;
  }

  async update(id: string, data: Partial<{ nombre: string; email: string }>) {
    const updated = await db().update(schema.clientes).set(data).where(eq(schema.clientes.id, id)).returning();
    return updated[0] ?? null;
  }

  async delete(id: string) {
    await db().delete(schema.clientes).where(eq(schema.clientes.id, id));
  }
}
```

## Dependencias
```
npm install better-sqlite3 drizzle-orm ulid
npm install -D @types/better-sqlite3 drizzle-kit
```

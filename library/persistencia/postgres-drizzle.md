# PostgreSQL con Drizzle ORM

**Categoría:** persistencia | **Cuándo usar:** Apps multi-usuario, concurrencia alta, datos relacionales complejos o despliegue en servidor (no Electron).

## Setup

```typescript
// db/client.ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

let _db: ReturnType<typeof drizzle> | null = null;

export function db() {
  if (!_db) {
    const client = postgres(process.env.DATABASE_URL!, {
      max: 10,               // pool de conexiones
      idle_timeout: 20,
      connect_timeout: 10,
    });
    _db = drizzle(client, { schema });
  }
  return _db;
}
```

## Esquema

```typescript
// db/schema.ts
import { pgTable, text, integer, timestamp, boolean, uuid } from "drizzle-orm/pg-core";

export const usuarios = pgTable("usuarios", {
  id:         uuid("id").primaryKey().defaultRandom(),
  email:      text("email").notNull().unique(),
  nombre:     text("nombre").notNull(),
  rol:        text("rol", { enum: ["admin", "usuario"] }).notNull().default("usuario"),
  activo:     boolean("activo").notNull().default(true),
  creadoEn:   timestamp("creado_en").notNull().defaultNow(),
  actualizadoEn: timestamp("actualizado_en").notNull().defaultNow(),
});

export const pedidos = pgTable("pedidos", {
  id:         uuid("id").primaryKey().defaultRandom(),
  usuarioId:  uuid("usuario_id").notNull().references(() => usuarios.id, { onDelete: "restrict" }),
  estado:     text("estado", { enum: ["pendiente", "confirmado", "entregado", "cancelado"] }).notNull().default("pendiente"),
  total:      integer("total").notNull(),           // céntimos para evitar decimales
  creadoEn:   timestamp("creado_en").notNull().defaultNow(),
});
```

## Diferencias clave vs SQLite

```typescript
// SQLite: text para fechas, ulid() para IDs
id: text("id").primaryKey()           // ulid manual
creadoEn: text("created_at").default(sql`(datetime('now'))`)

// PostgreSQL: uuid nativo, timestamp nativo
id: uuid("id").primaryKey().defaultRandom()   // UUID generado por Postgres
creadoEn: timestamp("creado_en").defaultNow()

// PostgreSQL: arrays nativos
tags: text("tags").array().notNull().default(sql`'{}'::text[]`)

// PostgreSQL: jsonb nativo
metadatos: jsonb("metadatos").$type<Record<string, unknown>>()
```

## Migraciones con drizzle-kit

```bash
# Generar migración
npx drizzle-kit generate

# Aplicar en desarrollo
npx drizzle-kit migrate

# drizzle.config.ts
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  schema: "./src/db/schema.ts",
  out:    "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

## Variables de entorno

```env
# .env
DATABASE_URL=postgresql://usuario:password@localhost:5432/mi_app
```

## Docker Compose para desarrollo

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: dev
      POSTGRES_PASSWORD: dev
      POSTGRES_DB: mi_app
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

## Dependencias

```
npm install drizzle-orm postgres
npm install -D drizzle-kit @types/pg
```

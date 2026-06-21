# PostgreSQL con Drizzle ORM — Patrón Repository

**Categoría:** persistencia | **Cuándo usar:** Aplicaciones cliente-servidor, múltiples usuarios, alta concurrencia

## Setup con Pool de conexiones

```typescript
// db/client.ts
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

export const db = drizzle(pool, { schema });
```

## Esquema ejemplo

```typescript
// db/schema.ts
import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const reservas = pgTable("reservas", {
  id: text("id").primaryKey(),
  clienteId: text("cliente_id").notNull(),
  fecha: timestamp("fecha").notNull(),
  estado: text("estado").notNull().default("pendiente"),
  cancelada: boolean("cancelada").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});
```

## Repository pattern

```typescript
export class ReservaRepository {
  async findPendientes() {
    return db.select().from(schema.reservas)
      .where(eq(schema.reservas.estado, "pendiente"));
  }

  async confirmar(id: string) {
    return db.update(schema.reservas)
      .set({ estado: "confirmada" })
      .where(eq(schema.reservas.id, id))
      .returning();
  }

  async cancelar(id: string) {
    return db.update(schema.reservas)
      .set({ cancelada: true, estado: "cancelada" })
      .where(eq(schema.reservas.id, id))
      .returning();
  }
}
```

## docker-compose para desarrollo

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: miapp
      POSTGRES_USER: admin
      POSTGRES_PASSWORD: secret
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

## Dependencias
```
npm install pg drizzle-orm
npm install -D @types/pg drizzle-kit
```

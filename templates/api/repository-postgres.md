# Template: Repository PostgreSQL + Drizzle

**tags:** repository, postgresql, drizzle, typescript
**transversal:** true

Reemplaza `Entidad` / `entidades` por el nombre de tu recurso.

```typescript
// src/db/schema.ts — añadir la tabla
import { pgTable, text, uuid, timestamp } from "drizzle-orm/pg-core";

export const entidades = pgTable("entidades", {
  id:            uuid("id").primaryKey().defaultRandom(),
  nombre:        text("nombre").notNull(),
  descripcion:   text("descripcion"),
  usuarioId:     uuid("usuario_id").notNull().references(() => usuarios.id, { onDelete: "restrict" }),
  creadoEn:      timestamp("creado_en").notNull().defaultNow(),
  actualizadoEn: timestamp("actualizado_en").notNull().defaultNow(),
});

export type Entidad      = typeof entidades.$inferSelect;
export type NuevaEntidad = typeof entidades.$inferInsert;
```

```typescript
// src/repositories/EntidadRepository.ts
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { entidades, type Entidad, type NuevaEntidad } from "../db/schema.js";

export class EntidadRepository {
  async findById(id: string): Promise<Entidad | null> {
    const rows = await db().select().from(entidades).where(eq(entidades.id, id));
    return rows[0] ?? null;
  }

  async findByNombre(nombre: string): Promise<Entidad | null> {
    const rows = await db().select().from(entidades).where(eq(entidades.nombre, nombre));
    return rows[0] ?? null;
  }

  async findAll(): Promise<Entidad[]> {
    return db().select().from(entidades);
  }

  async create(data: Omit<NuevaEntidad, "id" | "creadoEn" | "actualizadoEn">): Promise<Entidad> {
    const rows = await db().insert(entidades).values(data).returning();
    return rows[0]!;
  }

  async update(id: string, data: Partial<Omit<NuevaEntidad, "id" | "creadoEn">>): Promise<Entidad | null> {
    const rows = await db()
      .update(entidades)
      .set({ ...data, actualizadoEn: new Date() })
      .where(eq(entidades.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async delete(id: string): Promise<void> {
    await db().delete(entidades).where(eq(entidades.id, id));
  }
}
```

```bash
# Generar y aplicar migración
npx drizzle-kit generate
npx drizzle-kit migrate
```

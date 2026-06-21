# Template: Repository SQLite + Drizzle

**tags:** repository, sqlite, drizzle, typescript
**transversal:** true

Reemplaza `Entidad` / `entidades` por el nombre de tu recurso.

```typescript
// src/db/schema.ts — añadir la tabla
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const entidades = sqliteTable("entidades", {
  id:            text("id").primaryKey(),
  nombre:        text("nombre").notNull(),
  descripcion:   text("descripcion"),
  usuarioId:     text("usuario_id").notNull().references(() => usuarios.id),
  creadoEn:      text("creado_en").notNull().default(sql`(datetime('now'))`),
  actualizadoEn: text("actualizado_en").notNull().default(sql`(datetime('now'))`),
});

export type Entidad        = typeof entidades.$inferSelect;
export type NuevaEntidad   = typeof entidades.$inferInsert;
```

```typescript
// src/repositories/EntidadRepository.ts
import { eq, like, and } from "drizzle-orm";
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

  async create(data: NuevaEntidad): Promise<Entidad> {
    const rows = await db().insert(entidades).values(data).returning();
    return rows[0]!;
  }

  async update(id: string, data: Partial<Omit<NuevaEntidad, "id">>): Promise<Entidad | null> {
    const rows = await db()
      .update(entidades)
      .set({ ...data, actualizadoEn: new Date().toISOString() })
      .where(eq(entidades.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async delete(id: string): Promise<void> {
    await db().delete(entidades).where(eq(entidades.id, id));
  }

  async existsByUsuarioId(usuarioId: string): Promise<boolean> {
    const rows = await db()
      .select({ id: entidades.id })
      .from(entidades)
      .where(eq(entidades.usuarioId, usuarioId))
      .limit(1);
    return rows.length > 0;
  }
}
```

```typescript
// src/db/bootstrap.ts — añadir creación de tabla
db().run(sql`
  CREATE TABLE IF NOT EXISTS entidades (
    id             TEXT PRIMARY KEY,
    nombre         TEXT NOT NULL,
    descripcion    TEXT,
    usuario_id     TEXT NOT NULL REFERENCES usuarios(id),
    creado_en      TEXT NOT NULL DEFAULT (datetime('now')),
    actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
```

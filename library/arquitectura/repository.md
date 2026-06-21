# Patrón Repository

**Categoría:** arquitectura | **Cuándo usar:** Abstraer el acceso a datos, facilitar testing, soportar múltiples fuentes de datos

## Concepto
El Repository actúa como colección en memoria de objetos de dominio, ocultando los detalles de persistencia.

## Interface genérica

```typescript
export interface Repository<T, ID = string> {
  findById(id: ID): Promise<T | null>;
  findAll(): Promise<T[]>;
  save(entity: T): Promise<T>;
  delete(id: ID): Promise<void>;
}
```

## Implementación con SQLite/Drizzle

```typescript
export class ClienteRepositoryImpl implements Repository<Cliente> {
  async findById(id: string): Promise<Cliente | null> {
    const rows = await db().select().from(schema.clientes).where(eq(schema.clientes.id, id));
    return rows[0] ? this.toDomain(rows[0]) : null;
  }

  async save(cliente: Cliente): Promise<Cliente> {
    const existing = await this.findById(cliente.id);
    if (existing) {
      await db().update(schema.clientes)
        .set({ nombre: cliente.nombre, email: cliente.email })
        .where(eq(schema.clientes.id, cliente.id));
    } else {
      await db().insert(schema.clientes).values(this.toPersistence(cliente));
    }
    return cliente;
  }

  private toDomain(row: any): Cliente {
    return { id: row.id, nombre: row.nombre, email: row.email };
  }

  private toPersistence(c: Cliente) {
    return { id: c.id, nombre: c.nombre, email: c.email };
  }
}
```

## Beneficios
- El dominio no conoce la base de datos
- Fácil de mockear en tests: `new MockClienteRepository()`
- Cambiar de SQLite a PostgreSQL sin tocar la lógica de negocio

## En el andamiaje (patrón concreto, OBLIGATORIO)

Los andamiajes web (`server-app`) y de servicio (`api-server`) **ya cablean TODA la BD detrás de repos**:
NUNCA hay SQL suelto en rutas/servicios. Cópialo por cada entidad del dominio.

- Un fichero por agregado en `src/repos/<entidad>.repo.ts`: **interfaz (puerto)** + **implementación SQLite**.
  ```ts
  // src/repos/clientes.repo.ts
  export interface Cliente { id: string; nombre: string; email: string }
  export interface ClientesRepo {
    listar(): Cliente[];
    buscarPorId(id: string): Cliente | undefined;
    crear(c: Cliente): void;
  }
  export class ClientesRepoSqlite implements ClientesRepo {
    listar() { return getDb().prepare("SELECT * FROM clientes ORDER BY nombre").all() as Cliente[]; }
    // …
  }
  ```
- **Composition root** en `src/repos/index.ts`: el ÚNICO sitio que elige el motor. Registra ahí el repo nuevo:
  ```ts
  export interface Repos { /* … */ clientes: ClientesRepo }
  export const repos: Repos = { /* … */ clientes: new ClientesRepoSqlite() };
  ```
- Las rutas/servicios dependen de `repos.clientes` (la INTERFAZ), nunca de `getDb()` ni de SQLite.

**Cambiar de motor (SQLite → Postgres)**: crea `ClientesRepoPostgres implements ClientesRepo` y cámbialo en
`repos/index.ts` (o elige por `process.env.DB_DRIVER`). El resto de la app no se toca. Hoy todo es SQLite
(cero instalación; local y "Probar"); el repo deja el cambio listo para el futuro. Recetas del otro motor:
`library/persistencia/postgres-drizzle.md`, `library/persistencia/postgres-repository.md`.

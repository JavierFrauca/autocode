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
NUNCA hay SQL suelto en rutas/servicios. Además, `src/repos/base.repo.ts` trae una clase base
`BaseRepoSqlite<T>` con el CRUD que se repite en TODA entidad (`listar`, `buscarPorId`, `existe`, `borrar`).
**Cada entidad EXTIENDE esa base** y solo añade lo que de verdad es específico suyo (`crear`, `actualizar`,
búsquedas de negocio, joins) — no se reescribe el CRUD genérico a mano por entidad.

- Un fichero por agregado en `src/repos/<entidad>.repo.ts`: **interfaz (puerto)** + **clase que EXTIENDE
  `BaseRepoSqlite<T>`**.
  ```ts
  // src/repos/clientes.repo.ts
  import { BaseRepoSqlite } from "./base.repo.js";

  export interface Cliente { id: string; nombre: string; email: string }
  export interface ClientesRepo {
    listar(): Cliente[];          // heredado de BaseRepoSqlite
    buscarPorId(id: string): Cliente | undefined; // heredado
    crear(c: Cliente): void;      // específico de Cliente
  }
  export class ClientesRepoSqlite extends BaseRepoSqlite<Cliente> implements ClientesRepo {
    protected readonly tabla = "clientes";
    protected readonly idColumna = "id";
    crear(c: Cliente): void {
      this.db().prepare("INSERT INTO clientes (id, nombre, email) VALUES (?, ?, ?)").run(c.id, c.nombre, c.email);
    }
  }
  ```
- **Composition root** en `src/repos/index.ts`: el ÚNICO sitio que elige el motor. Registra ahí el repo nuevo:
  ```ts
  export interface Repos { /* … */ clientes: ClientesRepo }
  export const repos: Repos = { /* … */ clientes: new ClientesRepoSqlite() };
  ```
- Las rutas/servicios dependen de `repos.clientes` (la INTERFAZ), nunca de `getDb()` ni de SQLite.

**Consistencia entre entidades — no reinventar**: la PRIMERA entidad que construyas fija el patrón (extiende
`BaseRepoSqlite`, mismo estilo de nombres). Antes de escribir la SIGUIENTE, `leer_fichero` de un repo ya
creado y sigue EXACTAMENTE la misma forma — nunca una variante distinta (otra base, otro estilo de métodos)
sin un motivo de negocio real que lo justifique.

**Cambiar de motor (SQLite → Postgres)**: escribe una `BaseRepoPostgres<T>` alternativa (misma forma que
`BaseRepoSqlite`) y las implementaciones `<Entidad>RepoPostgres extends BaseRepoPostgres<T>`; cámbialas en
`repos/index.ts` (o elige por `process.env.DB_DRIVER`). El resto de la app no se toca porque depende de las
interfaces. Recetas del otro motor: `library/persistencia/postgres-drizzle.md`,
`library/persistencia/postgres-repository.md`.
